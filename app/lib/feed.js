import { createHash } from "node:crypto";

// Parses the supplier feed. Accepts a JSON array of objects, or CSV with a header row.
// Returns { items, errors } so one bad row never stops the whole feed.
//
// Accepted field names (first match wins):
//   sku | SKU
//   name | title
//   price | source_price
//   stock | quantity | qty
//   images | image      (JSON array, or URLs separated by "|" or ",")
//   description
//   specs               (JSON object, or "Key: value | Key: value")

export function parseFeed(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) {
    return { items: [], errors: [{ row: 0, sku: null, message: "Feed is empty." }] };
  }

  let rows;
  try {
    rows = /^[[{]/.test(trimmed) ? parseJsonRows(trimmed) : parseCsvRows(trimmed);
  } catch (error) {
    return { items: [], errors: [{ row: 0, sku: null, message: `Could not parse feed: ${error.message}` }] };
  }

  if (rows.length === 0) {
    return { items: [], errors: [{ row: 0, sku: null, message: "Feed contains no product rows." }] };
  }

  const items = [];
  const errors = [];
  const seen = new Set();

  rows.forEach((raw, index) => {
    const row = index + 1;
    const result = normalizeRow(raw);

    if (result.error) {
      errors.push({ row, sku: result.sku, message: result.error });
      return;
    }
    if (seen.has(result.item.sku)) {
      errors.push({ row, sku: result.item.sku, message: "Duplicate SKU in feed; first occurrence used." });
      return;
    }
    seen.add(result.item.sku);
    items.push(result.item);
  });

  return { items, errors };
}

export function contentHash(fields) {
  return createHash("sha256").update(JSON.stringify(fields)).digest("hex");
}

function parseJsonRows(text) {
  const data = JSON.parse(text);
  if (!Array.isArray(data)) throw new Error("JSON feed must be an array of products.");
  return data;
}

function normalizeRow(raw) {
  const pick = (...keys) => {
    for (const key of keys) {
      const value = raw?.[key];
      if (value !== undefined && value !== null && String(value).trim() !== "") return value;
    }
    return undefined;
  };

  const sku = String(pick("sku", "SKU") ?? "").trim();
  if (!sku) return { error: "Missing SKU.", sku: null };

  const name = String(pick("name", "title") ?? "").trim();
  if (!name) return { error: "Missing product name.", sku };

  const price = Number(pick("price", "source_price"));
  if (!Number.isFinite(price) || price < 0) return { error: `Invalid price: ${pick("price", "source_price")}`, sku };

  const stockRaw = pick("stock", "quantity", "qty");
  const stock = stockRaw === undefined ? 0 : Math.trunc(Number(stockRaw));
  if (!Number.isFinite(stock)) return { error: `Invalid stock: ${stockRaw}`, sku };

  const images = parseImages(pick("images", "image"));
  const specs = parseSpecs(pick("specs"));
  const description = String(pick("description") ?? "").trim();

  return {
    sku,
    item: { sku, name, price, stock, images, specs, description },
  };
}

function parseImages(value) {
  if (value === undefined) return [];
  const list = Array.isArray(value)
    ? value
    : String(value).split(/[|,]/);
  return list
    .map((url) => String(url).trim())
    .filter((url) => /^https?:\/\//i.test(url));
}

function parseSpecs(value) {
  if (value === undefined) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;

  const text = String(value).trim();
  if (text.startsWith("{")) {
    try {
      return JSON.parse(text);
    } catch {
      // fall through to key:value parsing
    }
  }

  const specs = {};
  for (const part of text.split("|")) {
    const idx = part.indexOf(":");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) specs[key] = val;
  }
  return specs;
}

// RFC 4180-style CSV: quoted fields, escaped quotes ("") and embedded newlines.
export function parseCsvRows(text) {
  const records = [];
  let field = "";
  let record = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      record.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      record.push(field);
      records.push(record);
      field = "";
      record = [];
    } else {
      field += ch;
    }
  }

  if (inQuotes) throw new Error("Unclosed quote in CSV.");
  if (field !== "" || record.length) {
    record.push(field);
    records.push(record);
  }

  const [header, ...body] = records.filter((r) => r.some((c) => c.trim() !== ""));
  if (!header) return [];

  const keys = header.map((h) => h.trim());
  return body.map((values) =>
    Object.fromEntries(keys.map((key, idx) => [key, values[idx] ?? ""])),
  );
}
