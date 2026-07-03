import crypto from "node:crypto";
import fs from "node:fs";
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

  async importRevisionWorkbooksFromFiles({ filePaths = [], actorId = null }) {
    const files = filePaths.map((filePath) => ({
      name: fileNameFromPath(filePath),
      sourceLabel: filePath,
      buffer: fs.readFileSync(filePath)
    }));

    return this.importRevisionWorkbooks({
      files,
      actorId
    });
  }

  async importRevisionWorkbooks({ files = [], actorId = null }) {
    const preparedRows = [];
    const warnings = [];

    for (const file of files) {
      const filePath = file.sourceLabel || file.name || "revision.xlsx";
      const workbook = XLSX.read(file.buffer, { type: "buffer", cellDates: false });
      workbook.SheetNames.forEach((sheetName) => {
        const sheetRows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });
        sheetRows.forEach((row, index) => {
          const normalized = normalizeRevisionRow({
            row,
            rowNumber: index + 1,
            filePath,
            sheetName
          });

          if (normalized) {
            preparedRows.push(normalized);
          } else {
            warnings.push({
              filePath: file.name || filePath,
              sheetName,
              row: index + 1,
              message: "Skipped row without product name or quantity"
            });
          }
        });
      });
    }

    const aggregatedRows = aggregateRevisionRows(preparedRows);

    return withTransaction(this.pool, async (db) => {
      const imported = [];

      for (const row of aggregatedRows) {
        const categoryId = await upsertCategory(db, row.category);
        const supplierId = await upsertSupplier(db, row.supplier);
        const productId = await upsertProduct(db, {
          id: createId("prod"),
          name: row.name,
          sku: row.sku,
          qrCode: null,
          barcode: row.barcode,
          categoryId,
          supplierId,
          unit: row.unit,
          minStock: 0,
          photoUrl: ""
        });

        const cellId = await upsertLocationChain(db, row.location);
        const currentInventoryRow =
          (await getInventoryRow(db, productId, cellId)) || { id: createId("inv"), quantity: 0 };
        const expectedQty = Number(currentInventoryRow.quantity || 0);
        const actualQty = Number(row.quantity || 0);
        const diffQty = actualQty - expectedQty;

        await upsertInventory(db, productId, cellId, actualQty);

        const createdAt = nowIso();
        const movementId = createId("move");
        await insertAuditImportMovement(db, {
          id: movementId,
          productId,
          quantity: Math.abs(diffQty),
          cellId,
          performedBy: actorId,
          comment: `РРјРїРѕСЂС‚ СЂРµРІРёР·РёРё: ${row.sourceLabel}`,
          metadata: {
            importType: "revision_workbook",
            filePath: row.filePath,
            sheetName: row.sheetName,
            sourceLabel: row.sourceLabel,
            sourceStorage: row.sourceStorage,
            quantityRaw: row.quantityRaw,
            expectedQty,
            actualQty,
            diffQty
          },
          createdAt
        });

        await insertInventoryHistoryRow(db, {
          id: createId("hist"),
          productId,
          cellId,
          movementId,
          previousQuantity: expectedQty,
          newQuantity: actualQty,
          changeQuantity: diffQty,
          changedBy: actorId,
          createdAt
        });

        await insertRevisionRow(db, {
          id: createId("rev"),
          movementId,
          cellId,
          expectedQty,
          actualQty,
          diffQty,
          status: diffQty === 0 ? "match" : "mismatch",
          checkedBy: actorId,
          createdAt
        });

        imported.push({
          productId,
          name: row.name,
          sku: row.sku,
          quantity: actualQty,
          unit: row.unit,
          source: row.sourceLabel
        });
      }

      await this.auditLogRepository.log(
        {
          id: createId("ulog"),
          userId: actorId,
          actionType: "revision_excel_import",
          entityType: "revision",
          entityId: null,
          oldValue: null,
          newValue: {
            importedCount: imported.length,
            files: files.map((file) => file.name || file.sourceLabel || "revision.xlsx")
          },
          createdAt: nowIso()
        },
        db
      );

      return {
        importedCount: imported.length,
        imported,
        warnings
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

function normalizeRevisionRow({ row, rowNumber, filePath, sheetName }) {
  const mapped = mapRevisionColumns(row);
  const name = cleanCellText(mapped.name);
  if (!name) {
    return null;
  }

  const quantityRaw = cleanCellText(mapped.quantityRaw);
  const quantity = parseRevisionQuantity(quantityRaw, mapped.unit);
  if (!Number.isFinite(quantity) || quantity < 0) {
    return null;
  }

  const article = cleanCellText(mapped.article);
  const unit = normalizeUnit(mapped.unit);
  const locationLabel = cleanCellText(mapped.location) || "\u0411\u0435\u0437 \u043c\u0435\u0441\u0442\u0430";
  const sourceLabel = `${fileNameFromPath(filePath)} / ${sheetName}`;
  const sku = buildRevisionSku(name, article);
  const location = buildRevisionLocation({
    filePath,
    sheetName,
    storageLabel: locationLabel
  });

  return {
    rowNumber,
    filePath,
    sheetName,
    sourceLabel,
    sourceStorage: locationLabel,
    category: "\u0420\u0435\u0432\u0438\u0437\u0438\u044f",
    supplier: cleanCellText(mapped.supplier) || "\u041d\u0435 \u0443\u043a\u0430\u0437\u0430\u043d",
    name,
    article,
    sku,
    barcode: sku,
    unit,
    quantityRaw,
    quantity,
    location
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
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (normalized) {
    return normalized;
  }

  return crypto.createHash("sha1").update(String(value || "")).digest("hex").slice(0, 12);
}

function mapRevisionColumns(row) {
  const entries = Object.entries(row || {}).map(([key, value]) => [normalizeHeader(key), value]);
  return {
    name: firstMappedValue(entries, [
      "\u041d\u0430\u0438\u043c\u0435\u043d\u043e\u0432\u0430\u043d\u0438\u0435",
      "\u041d\u0430\u0438\u043c\u0435\u043d\u043e\u0432\u0430\u043d\u0438\u0435 \u043a\u0430\u043a \u0432 1\u0421",
      "\u041d\u043e\u043c\u0435\u043d\u043a\u043b\u0430\u0442\u0443\u0440\u0430",
      "\u0422\u043e\u0432\u0430\u0440"
    ]),
    article: firstMappedValue(entries, [
      "\u0410\u0440\u0442\u0438\u043a\u0443\u043b",
      "\u0410\u0440\u0442\u0438\u043a\u0443\u043b \u0440\u0430\u0437\u043c\u0435\u0440",
      "\u0410\u0440\u0442\u0438\u043a\u0443\u043b \u043c\u0430\u0440\u043a\u0430",
      "\u0410\u0440\u0442\u0438\u043a\u0443\u043b/\u0420\u0430\u0437\u043c\u0435\u0440",
      "\u0410\u0440\u0442\u0438\u043a\u0443\u043b/\u041c\u0430\u0440\u043a\u0430"
    ]),
    unit: firstMappedValue(entries, [
      "\u0415\u0434. \u0438\u0437\u043c.",
      "\u0415\u0434 \u0438\u0437\u043c",
      "\u0415\u0434\u0438\u043d\u0438\u0446\u0430 \u0438\u0437\u043c\u0435\u0440\u0435\u043d\u0438\u044f",
      "\u0415\u0434\u0438\u0437\u043c"
    ]),
    location: firstMappedValue(entries, [
      "\u041c\u0435\u0441\u0442\u043e \u0445\u0440\u0430\u043d\u0435\u043d\u0438\u044f",
      "\u041c\u0435\u0441\u0442\u043e",
      "\u042f\u0447\u0435\u0439\u043a\u0430",
      "\u0421\u0442\u0435\u043b\u043b\u0430\u0436"
    ]),
    quantityRaw: firstMappedValue(entries, [
      "\u0424\u0430\u043a\u0442. \u043a\u043e\u043b-\u0432\u043e",
      "\u0424\u0430\u043a\u0442 \u043a\u043e\u043b\u0432\u043e",
      "\u041a\u043e\u043b-\u0432\u043e",
      "\u041a\u043e\u043b\u0432\u043e",
      "\u041a\u043e\u043b\u0438\u0447\u0435\u0441\u0442\u0432\u043e"
    ]),
    supplier: firstMappedValue(entries, [
      "\u041f\u043e\u0441\u0442\u0430\u0432\u0449\u0438\u043a",
      "\u041e\u0442 \u043a\u043e\u0433\u043e"
    ])
  };
}

function normalizeHeader(value) {
  return cleanCellText(value)
    .toLowerCase()
    .replace(/\u0451/g, "\u0435")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function firstMappedValue(entries, aliases) {
  const normalizedAliases = aliases.map((alias) => normalizeHeader(alias));

  for (const alias of normalizedAliases) {
    const found = entries.find(([key]) => key && (key === alias || key.includes(alias) || alias.includes(key)));
    if (found) {
      return found[1];
    }
  }

  return "";
}

function cleanCellText(value) {
  return String(value ?? "")
    .replace(/\u00A0/g, " ")
    .replace(/\u00D7/g, "x")
    .replace(/\u2192/g, "->")
    .replace(/\u2022/g, "-")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[\u201C\u201D\u201E]/g, "\"")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^\u0009\u000A\u000D\u0020-\u007E\u0400-\u045F\u2116]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeUnit(value) {
  const unit = cleanCellText(value).toLowerCase();
  if (!unit) {
    return "\u0448\u0442";
  }
  if (unit.includes("\u043a\u0433")) {
    return "\u043a\u0433";
  }
  if (unit.includes("\u043c2")) {
    return "\u043c2";
  }
  if (unit.includes("\u043c")) {
    return "\u043c";
  }
  if (unit.includes("\u043b")) {
    return "\u043b";
  }
  if (unit.includes("\u0443\u043f")) {
    return "\u0443\u043f";
  }
  return unit;
}

function parseRevisionQuantity(rawValue, unitValue) {
  if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
    return rawValue;
  }

  const raw = cleanCellText(rawValue).replace(/,/g, ".");
  if (!raw) {
    return Number.NaN;
  }

  const unit = normalizeUnit(unitValue);
  const aliases = unitAliases(unit);
  for (const alias of aliases) {
    const pattern = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${escapeRegex(alias)}`, "i");
    const match = raw.match(pattern);
    if (match) {
      return Number(match[1]);
    }
  }

  const withoutParentheses = raw.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  const plainMatches = [...withoutParentheses.matchAll(/\d+(?:\.\d+)?/g)].map((item) => Number(item[0]));
  if (plainMatches.length === 1) {
    return plainMatches[0];
  }

  const allMatches = [...raw.matchAll(/\d+(?:\.\d+)?/g)].map((item) => Number(item[0]));
  if (allMatches.length === 1) {
    return allMatches[0];
  }

  if (!allMatches.length) {
    return Number.NaN;
  }

  return allMatches[0];
}

function unitAliases(unit) {
  const map = {
    "\u0448\u0442": ["\u0448\u0442", "\u0448\u0442\u0443\u043a", "\u0448\u0442."],
    "\u043a\u0433": ["\u043a\u0433", "\u043a\u0438\u043b", "\u043a\u0433."],
    "\u043c": ["\u043c", "\u043c\u0435\u0442\u0440", "\u043c."],
    "\u043c2": ["\u043c2", "\u043c\u00b2"],
    "\u043b": ["\u043b", "\u043b\u0438\u0442\u0440", "\u043b."],
    "\u0443\u043f": [
      "\u0443\u043f",
      "\u0443\u043f.",
      "\u0443\u043f\u0430\u043a\u043e\u0432",
      "\u043a\u043e\u0440\u043e\u0431",
      "\u0431\u0443\u0445\u0442",
      "\u0440\u0443\u043b\u043e\u043d"
    ]
  };
  return map[unit] || [unit];
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildRevisionSku(name, article) {
  const articleValue = cleanCellText(article);
  if (articleValue) {
    const compact = articleValue
      .replace(/\s+/g, "-")
      .replace(/[^\\p{L}\\p{N}._-]+/gu, "")
      .slice(0, 40);
    if (compact) {
      return compact;
    }
  }

  const nameSlug = slug(transliterate(name)).slice(0, 24);
  const hash = crypto
    .createHash("sha1")
    .update(`${name}::${articleValue}`)
    .digest("hex")
    .slice(0, 8);
  return `REV-${nameSlug || "item"}-${hash}`.slice(0, 60);
}

function transliterate(value) {
  const map = {
    "\u0430": "a", "\u0431": "b", "\u0432": "v", "\u0433": "g", "\u0434": "d", "\u0435": "e", "\u0451": "e", "\u0436": "zh", "\u0437": "z", "\u0438": "i",
    "\u0439": "y", "\u043a": "k", "\u043b": "l", "\u043c": "m", "\u043d": "n", "\u043e": "o", "\u043f": "p", "\u0440": "r", "\u0441": "s", "\u0442": "t",
    "\u0443": "u", "\u0444": "f", "\u0445": "h", "\u0446": "c", "\u0447": "ch", "\u0448": "sh", "\u0449": "sch", "\u044a": "", "\u044b": "y", "\u044c": "",
    "\u044d": "e", "\u044e": "yu", "\u044f": "ya"
  };

  return String(value || "")
    .toLowerCase()
    .split("")
    .map((char) => map[char] ?? char)
    .join("");
}

function buildRevisionLocation({ filePath, sheetName, storageLabel }) {
  const fileCode = extractFileCode(filePath);
  const storageHash = crypto
    .createHash("sha1")
    .update(`${sheetName}::${storageLabel}`)
    .digest("hex")
    .slice(0, 4)
    .toUpperCase();

  return {
    warehouseName: "\u0420\u0435\u0432\u0438\u0437\u0438\u044f",
    rackCode: `REV-${fileCode}`,
    shelfCode: slug(transliterate(sheetName)).slice(0, 6).toUpperCase() || "SHEET",
    cellCode: storageHash
  };
}

function extractFileCode(filePath) {
  const match = fileNameFromPath(filePath).match(/(\d+)/);
  return match ? match[1] : "X";
}

function fileNameFromPath(filePath) {
  return String(filePath || "").split(/[/\\]/).pop() || "file";
}

function aggregateRevisionRows(rows) {
  const groups = new Map();

  for (const row of rows) {
    const key = [
      row.sku,
      row.location.warehouseName,
      row.location.rackCode,
      row.location.shelfCode,
      row.location.cellCode
    ].join("::");

    const current = groups.get(key);
    if (!current) {
      groups.set(key, { ...row });
      continue;
    }

    current.quantity += row.quantity;
    current.quantityRaw = `${current.quantityRaw}; ${row.quantityRaw}`;
  }

  return Array.from(groups.values());
}

async function getInventoryRow(db, productId, cellId) {
  const result = await db.query(
    `
      SELECT id, quantity
      FROM inventory
      WHERE product_id = $1 AND cell_id = $2
      LIMIT 1
    `,
    [productId, cellId]
  );

  return result.rows[0] || null;
}

async function insertAuditImportMovement(db, movement) {
  await db.query(
    `
      INSERT INTO stock_movements (
        id, movement_type, product_id, quantity, from_cell_id, to_cell_id, performed_by, comment, reference_code, metadata, created_at
      ) VALUES ($1, 'audit', $2, $3, $4, $4, $5, $6, $7, $8::jsonb, $9)
    `,
    [
      movement.id,
      movement.productId,
      movement.quantity,
      movement.cellId,
      movement.performedBy || null,
      cleanCellText(movement.comment || ""),
      "revision-import",
      JSON.stringify(sanitizeSerializable(movement.metadata || {})),
      movement.createdAt
    ]
  );
}

async function insertInventoryHistoryRow(db, history) {
  await db.query(
    `
      INSERT INTO inventory_history (
        id, product_id, cell_id, movement_id, previous_quantity, new_quantity, change_quantity, changed_by, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
    [
      history.id,
      history.productId,
      history.cellId,
      history.movementId,
      history.previousQuantity,
      history.newQuantity,
      history.changeQuantity,
      history.changedBy || null,
      history.createdAt
    ]
  );
}

async function insertRevisionRow(db, revision) {
  await db.query(
    `
      INSERT INTO revisions (
        id, movement_id, cell_id, expected_qty, actual_qty, diff_qty, status, checked_by, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
    [
      revision.id,
      revision.movementId,
      revision.cellId,
      revision.expectedQty,
      revision.actualQty,
      revision.diffQty,
      revision.status,
      revision.checkedBy || null,
      revision.createdAt
    ]
  );
}

function sanitizeSerializable(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeSerializable(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, sanitizeSerializable(item)])
    );
  }

  if (typeof value === "string") {
    return cleanCellText(value);
  }

  return value;
}



