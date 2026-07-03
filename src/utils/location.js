import { createId } from "./ids.js";

export function buildLocationChain({ warehouseName, rackCode, shelfCode, cellCode }) {
  const warehouseCode = String(warehouseName || "main")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");

  return {
    warehouse: {
      id: `wh-${warehouseCode}`,
      code: warehouseCode.toUpperCase(),
      name: warehouseName || "Main"
    },
    rack: {
      id: `rack-${warehouseCode}-${sanitizeCode(rackCode)}`,
      code: rackCode,
      name: `Стеллаж ${rackCode}`
    },
    shelf: {
      id: `shelf-${warehouseCode}-${sanitizeCode(rackCode)}-${sanitizeCode(shelfCode)}`,
      code: shelfCode,
      name: `Полка ${shelfCode}`
    },
    cell: {
      id: `cell-${warehouseCode}-${sanitizeCode(rackCode)}-${sanitizeCode(shelfCode)}-${sanitizeCode(cellCode)}`,
      code: cellCode,
      barcode: createId("cell"),
      fullCode: `${rackCode}/${shelfCode}/${cellCode}`
    }
  };
}

export function parseLegacyLocation(location) {
  return buildLocationChain({
    warehouseName: location.warehouse || "Main",
    rackCode: location.rack || "A-01",
    shelfCode: location.shelf || "1",
    cellCode: location.cell || "A"
  });
}

function sanitizeCode(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
}
