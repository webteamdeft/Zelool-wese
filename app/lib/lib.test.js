import { test } from "node:test";
import assert from "node:assert/strict";
import { calculatePrice } from "./pricing.js";
import { normalizeStock, resolveStatus } from "./inventory.js";
import { parseFeed, parseCsvRows, contentHash } from "./feed.js";

// ---------- Pricing ----------

test("85% markup rounds UP to the next whole dollar", () => {
  assert.equal(calculatePrice(10, 85), 19); // 18.50 -> 19
  assert.equal(calculatePrice(12.34, 85), 23); // 22.829 -> 23
  assert.equal(calculatePrice(100, 85), 185); // 185.00 stays 185
});

test("floating point noise does not add an extra dollar", () => {
  assert.equal(calculatePrice(20, 85), 37); // 20 * 1.85 = 37.00000000000001 in JS
});

test("zero source price gives zero", () => {
  assert.equal(calculatePrice(0, 85), 0);
});

test("markup is configurable", () => {
  assert.equal(calculatePrice(10, 50), 15);
  assert.equal(calculatePrice(10, "85"), 19);
});

test("invalid inputs throw", () => {
  assert.throws(() => calculatePrice(-1, 85), /Invalid source price/);
  assert.throws(() => calculatePrice("abc", 85), /Invalid source price/);
  assert.throws(() => calculatePrice(10, -5), /Invalid markup/);
});

// ---------- Inventory rules ----------

test("negative stock is pushed as 0 with a warning", () => {
  const result = normalizeStock(-3);
  assert.equal(result.quantity, 0);
  assert.equal(result.isOutOfStock, true);
  assert.match(result.warning, /negative/);
});

test("zero stock is pushed as 0 without a warning", () => {
  const result = normalizeStock(0);
  assert.equal(result.quantity, 0);
  assert.equal(result.isOutOfStock, true);
  assert.equal(result.warning, null);
});

test("positive stock is pushed unchanged", () => {
  const result = normalizeStock(7);
  assert.equal(result.quantity, 7);
  assert.equal(result.isOutOfStock, false);
});

test("new products are always created as DRAFT", () => {
  assert.equal(resolveStatus({ isNew: true, currentStatus: "ACTIVE", isOutOfStock: false, outOfStockAction: "keep" }), "DRAFT");
});

test("out-of-stock active product goes to DRAFT only when rule is 'draft'", () => {
  assert.equal(resolveStatus({ currentStatus: "ACTIVE", isOutOfStock: true, outOfStockAction: "draft" }), "DRAFT");
  assert.equal(resolveStatus({ currentStatus: "ACTIVE", isOutOfStock: true, outOfStockAction: "keep" }), "ACTIVE");
});

test("a DRAFT product stays DRAFT when stock returns (client publishes manually)", () => {
  assert.equal(resolveStatus({ currentStatus: "DRAFT", isOutOfStock: false, outOfStockAction: "draft" }), "DRAFT");
});

// ---------- CSV parsing ----------

test("CSV handles quoted commas, escaped quotes and CRLF", () => {
  const rows = parseCsvRows('sku,name,price\r\nA1,"Round, Gold",10\r\nA2,"Say ""hi""",12\r\n');
  assert.deepEqual(rows, [
    { sku: "A1", name: "Round, Gold", price: "10" },
    { sku: "A2", name: 'Say "hi"', price: "12" },
  ]);
});

test("CSV throws on an unclosed quote", () => {
  assert.throws(() => parseCsvRows('sku,name\nA1,"oops'), /Unclosed quote/);
});

// ---------- Feed parsing ----------

test("JSON feed is normalized", () => {
  const { items, errors } = parseFeed(
    JSON.stringify([
      {
        sku: " Z-100 ",
        name: "Round Frame",
        price: "10",
        stock: "5",
        images: ["https://img.example/a.jpg", "not-a-url"],
        specs: { Material: "Titanium" },
      },
    ]),
  );
  assert.equal(errors.length, 0);
  assert.equal(items[0].sku, "Z-100");
  assert.equal(items[0].price, 10);
  assert.equal(items[0].stock, 5);
  assert.deepEqual(items[0].images, ["https://img.example/a.jpg"]);
  assert.deepEqual(items[0].specs, { Material: "Titanium" });
});

test("CSV feed with pipe-separated images and key:value specs", () => {
  const csv = [
    "sku,name,price,stock,images,specs",
    'A1,Square,20,3,"https://x.test/1.jpg|https://x.test/2.jpg","Material: Acetate | Width: 140mm"',
  ].join("\n");
  const { items, errors } = parseFeed(csv);
  assert.equal(errors.length, 0);
  assert.equal(items[0].images.length, 2);
  assert.deepEqual(items[0].specs, { Material: "Acetate", Width: "140mm" });
});

test("bad rows are reported but do not stop good rows", () => {
  const { items, errors } = parseFeed(
    JSON.stringify([
      { sku: "OK", name: "Good", price: 5, stock: 1 },
      { name: "No sku", price: 5 },
      { sku: "NOPRICE", name: "Bad", price: "abc" },
      { sku: "NONAME", price: 5 },
    ]),
  );
  assert.deepEqual(items.map((i) => i.sku), ["OK"]);
  assert.equal(errors.length, 3);
  assert.equal(errors[0].sku, null);
  assert.match(errors[1].message, /Invalid price/);
});

test("duplicate SKUs in the feed keep the first occurrence", () => {
  const { items, errors } = parseFeed(
    JSON.stringify([
      { sku: "DUP", name: "First", price: 5 },
      { sku: "DUP", name: "Second", price: 6 },
    ]),
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].name, "First");
  assert.match(errors[0].message, /Duplicate SKU/);
});

test("empty and invalid feeds return an error instead of throwing", () => {
  assert.equal(parseFeed("").errors[0].message, "Feed is empty.");
  assert.match(parseFeed("[not json").errors[0].message, /Could not parse feed/);
  assert.match(parseFeed('{"a":1}').errors[0].message, /array/);
});

test("content hash changes when content changes and is stable otherwise", () => {
  const a = contentHash({ name: "A", price: 19 });
  assert.equal(a, contentHash({ name: "A", price: 19 }));
  assert.notEqual(a, contentHash({ name: "A", price: 20 }));
});
