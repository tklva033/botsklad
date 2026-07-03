import crypto from "node:crypto";
import * as XLSX from "xlsx";
import { withTransaction } from "../database/postgres.js";
import { createId } from "../utils/ids.js";
import { nowIso } from "../utils/dates.js";
import { buildLocationChain } from "../utils/location.js";

const previewStore = new Map();

export class ImportExportService {
  constructor({ pool, auditLogRepository }) {
    this.pool = pool;
    this.auditLogRepository = auditLogRepository;
  }

  async importProductsWorkbook({ base64Data, actorId }) {
    const preview = await this.validateProductsWorkbook({ base64Data, actorId });
    if (!preview.canImport) {
      return {
        importedCount: 0,
        imported: [],
        skippedCount: preview.errors.length,
        errors: preview.errors,
        warnings: preview.warnings,
        previewToken: preview.previewToken
      };
    }

    return this.confirmProductsWorkbook({
      previewToken: preview.previewToken,
      actorId
    });
  }

  async validateProductsWorkbook({ base64Data, actorId }) {
    if (!base64Data) {
      return {
        canImport: false,
        previewToken: null,
        summary: emptyPreviewSummary(),
        rows: [],
        errors: [{ row: 0, field: "file", message: "Excel file payload is empty" }],
        warnings: []
      };
    }

    const workbook = XLSX.read(Buffer.from(base64Data, "base64"), { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });

    const normalizedRows = [];
    const errors = [];
    const warnings = [];
    let validRows = 0;

    rows.forEach((row, index) => {
      const rowNumber = index + 1;
      const normalized = normalizeImportRow(row, rowNumber);
      normalizedRows.push(normalized.preview);
      errors.push(...normalized.errors);
      warnings.push(...normalized.warnings);
      if (!normalized.errors.length) {
        validRows += 1;
      }
    });

    const previewToken = crypto.randomUUID();
    previewStore.set(previewToken, {
      actorId: actorId || null,
      createdAt: Date.now(),
      rows: normalizedRows
        .filter((row) => row.isValid)
        .map((row) => ({
          id: row.id,
          name: row.name,
          sku: row.sku,
          qrCode: row.qrCode,
          barcode: row.barcode,
          category: row.category,
          supplier: row.supplier,
          unit: row.unit,
          minStock: row.minStock,
          photoUrl: row.photoUrl,
          quantity: row.quantity,
          warehouseName: row.warehouseName,
          rackCode: row.rackCode,
          shelfCode: row.shelfCode,
          cellCode: row.cellCode
        }))
    });

    prunePreviewStore();

    return {
      canImport: errors.length === 0 && validRows > 0,
      previewToken,
      summary: {
        totalRows: rows.length,
        validRows,
        errorRows: new Set(errors.map((item) => item.row)).size,
        warningRows: new Set(warnings.map((item) => item.row)).size
      },
      rows: normalizedRows,
      errors,
      warnings
    };
  }

  async confirmProductsWorkbook({ previewToken, actorId }) {
    const preview = previewStore.get(previewToken);
    if (!preview) {
      return {
        importedCount: 0,
        imported: [],
        skippedCount: 1,
        errors: [{ row: 0, field: "previewToken", message: "Import preview expired. Validate the file again." }]
      };
    }

    previewStore.delete(previewToken);

    return withTransaction(this.pool, async (db) => {
      const imported = [];

      for (const row of preview.rows) {
        const categoryId = await upsertCategory(db, row.category || "General");
        const supplierId = await upsertSupplier(db, row.supplier || "Main Supplier");
        const productId = await upsertProduct(db, {
          id: row.id || createId("prod"),
          name: row.name,
          sku: row.sku,
          qrCode: row.qrCode || null,
          barcode: row.barcode || row.sku,
          categoryId,
          supplierId,
          unit: row.unit || "pcs",
          minStock: Number(row.minStock || 0),
          photoUrl: row.photoUrl || ""
        });

        const cellId = await upsertLocationChain(db, {
          warehouseName: row.warehouseName,
          rackCode: row.rackCode,
          shelfCode: row.shelfCode,
          cellCode: row.cellCode
        });

        await upsertInventory(db, productId, cellId, Number(row.quantity || 0));
        imported.push({
          row: row.rowNumber,
          productId,
          sku: row.sku,
          quantity: Number(row.quantity || 0)
        });
      }

      await this.auditLogRepository.log(
        {
          id: createId("ulog"),
          userId: actorId || preview.actorId || null,
          actionType: "excel_import",
          entityType: "products",
          entityId: null,
          oldValue: null,
          newValue: { count: imported.length },
          createdAt: nowIso()
        },
        db
      );

      return {
        importedCount: imported.length,
        imported,
        skippedCount: 0,
        errors: [],
        warnings: []
      };
    });
  }
}

function normalizeImportRow(row, rowNumber) {
  const preview = {
    rowNumber,
    id: row.Id || "",
    name: String(row.Name || row.name || "").trim(),
    sku: String(row.SKU || row.sku || "").trim(),
    qrCode: String(row.QRCode || row.qrCode || "").trim(),
    barcode: String(row.Barcode || row.barcode || "").trim(),
    category: String(row.Category || row.category || "General").trim(),
    supplier: String(row.Supplier || row.supplier || "Main Supplier").trim(),
    unit: String(row.Unit || row.unit || "pcs").trim(),
    minStock: Number(row.MinStock || row.minStock || 0),
    photoUrl: String(row.PhotoUrl || row.photoUrl || "").trim(),
    quantity: Number(row.Quantity || row.quantity || 0),
    warehouseName: String(row.Warehouse || row.warehouse || "Main").trim(),
    rackCode: String(row.Rack || row.rack || "A-01").trim(),
    shelfCode: String(row.Shelf || row.shelf || "1").trim(),
    cellCode: String(row.Cell || row.cell || "A").trim(),
    isValid: true
  };

  const errors = [];
  const warnings = [];

  if (!preview.name) {
    errors.push({ row: rowNumber, field: "name", message: "Name is required" });
  }
  if (!preview.sku) {
    errors.push({ row: rowNumber, field: "sku", message: "SKU is required" });
  }
  if (!Number.isFinite(preview.quantity) || preview.quantity < 0) {
    errors.push({ row: rowNumber, field: "quantity", message: "Quantity must be zero or greater" });
  }
  if (!Number.isFinite(preview.minStock) || preview.minStock < 0) {
    errors.push({ row: rowNumber, field: "minStock", message: "Minimum stock must be zero or greater" });
  }
  if (!preview.warehouseName) {
    warnings.push({ row: rowNumber, field: "warehouse", message: "Warehouse was not provided. Main will be used." });
    preview.warehouseName = "Main";
  }
  if (!preview.rackCode) {
    warnings.push({ row: rowNumber, field: "rack", message: "Rack was not provided. A-01 will be used." });
    preview.rackCode = "A-01";
  }
  if (!preview.shelfCode) {
    warnings.push({ row: rowNumber, field: "shelf", message: "Shelf was not provided. 1 will be used." });
    preview.shelfCode = "1";
  }
  if (!preview.cellCode) {
    warnings.push({ row: rowNumber, field: "cell", message: "Cell was not provided. A will be used." });
    preview.cellCode = "A";
  }

  preview.barcode = preview.barcode || preview.sku;
  preview.isValid = errors.length === 0;

  return {
    preview,
    errors,
    warnings
  };
}

function emptyPreviewSummary() {
  return {
    totalRows: 0,
    validRows: 0,
    errorRows: 0,
    warningRows: 0
  };
}

function prunePreviewStore() {
  const ttlMs = 30 * 60 * 1000;
  const now = Date.now();
  for (const [token, preview] of previewStore.entries()) {
    if (now - preview.createdAt > ttlMs) {
      previewStore.delete(token);
    }
  }
}

async function upsertCategory(db, name) {
  const id = `cat-${slug(name)}`;
  await db.query(
    `INSERT INTO categories (id, name) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
    [id, name]
  );
  return id;
}

async function upsertSupplier(db, name) {
  const id = `sup-${slug(name)}`;
  await db.query(
    `INSERT INTO suppliers (id, name) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
    [id, name]
  );
  return id;
}

async function upsertProduct(db, product) {
  await db.query(
    `
      INSERT INTO products (
        id, name, sku, qr_code, barcode, category_id, supplier_id, unit, min_stock, photo_url, is_active, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,TRUE,NOW(),NOW())
      ON CONFLICT (sku) DO UPDATE
      SET name = EXCLUDED.name,
          qr_code = EXCLUDED.qr_code,
          barcode = EXCLUDED.barcode,
          category_id = EXCLUDED.category_id,
          supplier_id = EXCLUDED.supplier_id,
          unit = EXCLUDED.unit,
          min_stock = EXCLUDED.min_stock,
          photo_url = EXCLUDED.photo_url,
          updated_at = NOW()
    `,
    [
      product.id,
      product.name,
      product.sku,
      product.qrCode,
      product.barcode,
      product.categoryId,
      product.supplierId,
      product.unit,
      product.minStock,
      product.photoUrl
    ]
  );

  const result = await db.query(`SELECT id FROM products WHERE sku = $1 LIMIT 1`, [product.sku]);
  return result.rows[0].id;
}

async function upsertLocationChain(db, { warehouseName, rackCode, shelfCode, cellCode }) {
  const chain = buildLocationChain({ warehouseName, rackCode, shelfCode, cellCode });

  await db.query(
    `INSERT INTO warehouses (id, name, code) VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, code = EXCLUDED.code`,
    [chain.warehouse.id, chain.warehouse.name, chain.warehouse.code]
  );
  await db.query(
    `INSERT INTO racks (id, warehouse_id, code, name) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code, name = EXCLUDED.name`,
    [chain.rack.id, chain.warehouse.id, chain.rack.code, chain.rack.name]
  );
  await db.query(
    `INSERT INTO shelves (id, rack_id, code, name) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code, name = EXCLUDED.name`,
    [chain.shelf.id, chain.rack.id, chain.shelf.code, chain.shelf.name]
  );
  await db.query(
    `INSERT INTO cells (id, shelf_id, code, barcode, full_code) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code, barcode = EXCLUDED.barcode, full_code = EXCLUDED.full_code`,
    [chain.cell.id, chain.shelf.id, chain.cell.code, chain.cell.barcode, chain.cell.fullCode]
  );

  return chain.cell.id;
}

async function upsertInventory(db, productId, cellId, quantity) {
  await db.query(
    `
      INSERT INTO inventory (id, product_id, cell_id, quantity, updated_at)
      VALUES ($1,$2,$3,$4,NOW())
      ON CONFLICT (product_id, cell_id) DO UPDATE
      SET quantity = EXCLUDED.quantity,
          updated_at = NOW()
    `,
    [createId("inv"), productId, cellId, quantity]
  );
}

function slug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
}
