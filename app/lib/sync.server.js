import prisma from "../db.server";
import { calculatePrice, formatMoney } from "./pricing.js";
import { normalizeStock, resolveStatus } from "./inventory.js";
import { parseFeed, contentHash } from "./feed.js";
import { getSettings } from "./settings.server.js";

const STALE_RUN_MS = 60 * 60 * 1000; // a "running" run older than this is treated as crashed
const FEED_TIMEOUT_MS = 120 * 1000;

const FIND_VARIANT_BY_SKU = `#graphql
  query findVariantBySku($query: String!) {
    productVariants(first: 5, query: $query) {
      nodes {
        id
        sku
        product { id status }
        inventoryItem { id }
      }
    }
  }`;

const PRODUCT_SET = `#graphql
  mutation syncFrameProduct($identifier: ProductSetIdentifiers, $input: ProductSetInput!) {
    productSet(identifier: $identifier, input: $input, synchronous: true) {
      product {
        id
        status
        variants(first: 1) {
          nodes { id sku inventoryItem { id } }
        }
      }
      userErrors { field message code }
    }
  }`;

const UPDATE_VARIANT_PRICE = `#graphql
  mutation updateVariantPrice($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      userErrors { field message }
    }
  }`;

// Starts a sync in the background and returns immediately with the run id.
// Only one run may be active at a time.
export async function startSync({ admin, trigger = "manual" }) {
  await prisma.syncRun.updateMany({
    where: { status: "running", startedAt: { lt: new Date(Date.now() - STALE_RUN_MS) } },
    data: { status: "failed", finishedAt: new Date() },
  });

  const active = await prisma.syncRun.findFirst({ where: { status: "running" } });
  if (active) return { alreadyRunning: true, runId: active.id };

  const run = await prisma.syncRun.create({ data: { trigger } });

  executeRun(run.id, admin).catch(async (error) => {
    console.error("Sync crashed", error);
    await writeLog(run.id, "error", null, `Sync stopped unexpectedly: ${error.message}`);
    await prisma.syncRun.update({
      where: { id: run.id },
      data: { status: "failed", finishedAt: new Date() },
    });
  });

  return { runId: run.id };
}

async function writeLog(runId, level, sku, message) {
  await prisma.syncLog.create({ data: { runId, level, sku, message } });
}

async function executeRun(runId, admin) {
  const counts = { created: 0, updated: 0, skipped: 0, failed: 0 };
  const log = (level, sku, message) => writeLog(runId, level, sku, message);

  try {
    const settings = await getSettings();
    if (!settings.feedUrl) throw new Error("No feed URL set. Add one under Pricing & settings.");
    if (!settings.locationId) {
      throw new Error("No inventory location selected. Choose one under Pricing & settings.");
    }

    await log("info", null, `Fetching feed from ${settings.feedUrl}`);
    const response = await fetch(settings.feedUrl, {
      signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Feed request failed with HTTP ${response.status}.`);

    const { items, errors } = parseFeed(await response.text());
    for (const error of errors) {
      counts.failed++;
      await log("error", error.sku, error.row ? `Row ${error.row}: ${error.message}` : error.message);
    }
    await log("info", null, `Feed parsed: ${items.length} valid product(s), ${errors.length} rejected.`);

    const seenSkus = new Set([
      ...items.map((item) => item.sku),
      ...errors.map((error) => error.sku).filter(Boolean),
    ]);

    for (const item of items) {
      try {
        counts[await syncItem(item, settings, admin, log)]++;
      } catch (error) {
        counts.failed++;
        await log("error", item.sku, error.message);
        await prisma.frame.updateMany({ where: { sku: item.sku }, data: { lastError: error.message } });
      }
    }

    // Products that were in an earlier feed but are gone now are reported, never deleted.
    const missing = await prisma.frame.findMany({
      where: { inSource: true, sku: { notIn: [...seenSkus] } },
      select: { sku: true },
    });
    for (const frame of missing) {
      await prisma.frame.update({ where: { sku: frame.sku }, data: { inSource: false } });
      await log("warn", frame.sku, "No longer in the feed. Left unchanged in Shopify; review manually.");
    }

    await finishRun(runId, counts, counts.failed > 0 ? "completed_with_errors" : "completed");
  } catch (error) {
    counts.failed++;
    await log("error", null, error.message);
    await finishRun(runId, counts, "failed");
  }
}

async function finishRun(runId, counts, status) {
  await prisma.syncRun.update({
    where: { id: runId },
    data: {
      status,
      finishedAt: new Date(),
      created: counts.created,
      updated: counts.updated,
      skipped: counts.skipped,
      failed: counts.failed,
    },
  });
}

// Returns "created" | "updated" | "skipped". Throws on a Shopify or data error.
async function syncItem(item, settings, admin, log) {
  const frame = await prisma.frame.findUnique({ where: { sku: item.sku } });

  // Reuse a Shopify product with this SKU if one exists (prevents duplicates).
  const linked = frame?.shopifyProductId
    ? {
        productId: frame.shopifyProductId,
        variantId: frame.shopifyVariantId,
        inventoryItemId: frame.shopifyInventoryItemId,
        status: frame.shopifyStatus,
      }
    : await findShopifyVariantBySku(admin, item.sku);

  const isNewToShopify = !linked;
  const priceLocked = frame?.priceLocked ?? false;
  const price = priceLocked ? frame.price : calculatePrice(item.price, settings.markupPercent);

  const { quantity, isOutOfStock, warning } = normalizeStock(item.stock);
  if (warning) await log("warn", item.sku, warning);

  const status = resolveStatus({
    currentStatus: linked?.status,
    isNew: isNewToShopify,
    isOutOfStock,
    outOfStockAction: settings.outOfStockAction,
  });

  const images = item.images;
  const hash = contentHash({
    name: item.name,
    description: item.description,
    specs: item.specs,
    images,
    price,
    quantity,
  });

  const unchanged =
    frame &&
    !isNewToShopify &&
    frame.contentHash === hash &&
    frame.shopifyStatus === status &&
    frame.inSource &&
    !frame.lastError;

  if (unchanged) {
    await prisma.frame.update({ where: { sku: item.sku }, data: { lastSyncedAt: new Date() } });
    return "skipped";
  }

  const imagesChanged = isNewToShopify || !frame || frame.images !== JSON.stringify(images);

  const input = {
    title: item.name,
    descriptionHtml: buildDescriptionHtml(item.description, item.specs),
    status,
    variants: [
      {
        ...(linked?.variantId ? { id: linked.variantId } : {}),
        sku: item.sku,
        price: formatMoney(price),
        inventoryQuantities: [
          { locationId: settings.locationId, name: "available", quantity },
        ],
      },
    ],
    ...(imagesChanged && images.length
      ? { files: images.map((url) => ({ originalSource: url, contentType: "IMAGE" })) }
      : {}),
  };

  const response = await admin.graphql(PRODUCT_SET, {
    variables: {
      identifier: linked?.productId ? { id: linked.productId } : undefined,
      input,
    },
  });
  const json = await response.json();

  if (json.errors?.length) {
    throw new Error(`Shopify API error: ${json.errors.map((e) => e.message).join("; ")}`);
  }
  const payload = json.data?.productSet;
  if (!payload) throw new Error("Shopify returned no result for productSet.");
  if (payload.userErrors?.length) {
    throw new Error(`Shopify rejected the product: ${payload.userErrors.map((e) => e.message).join("; ")}`);
  }

  const product = payload.product;
  const variant = product.variants.nodes[0];

  const data = {
    name: item.name,
    description: item.description || null,
    specs: JSON.stringify(item.specs),
    images: JSON.stringify(images),
    sourcePrice: item.price,
    sourceStock: item.stock,
    price,
    stock: quantity,
    shopifyProductId: product.id,
    shopifyVariantId: variant.id,
    shopifyInventoryItemId: variant.inventoryItem.id,
    shopifyStatus: product.status,
    contentHash: hash,
    inSource: true,
    lastSyncedAt: new Date(),
    lastError: null,
  };

  if (frame) {
    await prisma.frame.update({ where: { sku: item.sku }, data });
  } else {
    await prisma.frame.create({ data: { sku: item.sku, priceLocked: false, ...data } });
  }

  await log(
    "info",
    item.sku,
    `${isNewToShopify ? "Created" : "Updated"} (${product.status}): price $${price}, stock ${quantity}${priceLocked ? ", price locked" : ""}.`,
  );

  return isNewToShopify ? "created" : "updated";
}

async function findShopifyVariantBySku(admin, sku) {
  const escaped = sku.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const response = await admin.graphql(FIND_VARIANT_BY_SKU, {
    variables: { query: `sku:"${escaped}"` },
  });
  const json = await response.json();

  // If the lookup fails we must not guess, or we could create a duplicate.
  if (json.errors?.length) {
    throw new Error(`SKU lookup failed: ${json.errors.map((e) => e.message).join("; ")}`);
  }

  const node = json.data?.productVariants?.nodes?.find((n) => n.sku === sku);
  if (!node) return null;

  return {
    productId: node.product.id,
    variantId: node.id,
    inventoryItemId: node.inventoryItem.id,
    status: node.product.status,
  };
}

// Pushes a manually edited price to Shopify right away.
export async function pushVariantPrice(admin, frame, price) {
  const response = await admin.graphql(UPDATE_VARIANT_PRICE, {
    variables: {
      productId: frame.shopifyProductId,
      variants: [{ id: frame.shopifyVariantId, price: formatMoney(price) }],
    },
  });
  const json = await response.json();
  const errors = json.data?.productVariantsBulkUpdate?.userErrors ?? [];
  if (errors.length) throw new Error(errors.map((e) => e.message).join("; "));
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildDescriptionHtml(description, specs) {
  const parts = [];
  if (description) parts.push(`<p>${escapeHtml(description)}</p>`);

  const entries = Object.entries(specs ?? {});
  if (entries.length) {
    const items = entries
      .map(([key, value]) => `<li><strong>${escapeHtml(key)}:</strong> ${escapeHtml(value)}</li>`)
      .join("");
    parts.push(`<h3>Specifications</h3><ul>${items}</ul>`);
  }

  return parts.join("");
}
