// Stock rules (proposed defaults, pending client approval):
//  - Negative source stock is pushed to Shopify as 0 and logged as a warning.
//  - Zero stock is pushed as 0 (never negative).
//  - If an ACTIVE product reaches zero and outOfStockAction is "draft", it is moved
//    back to DRAFT. A DRAFT product is never published automatically.
//  - New products are always created as DRAFT.

export function normalizeStock(sourceStock) {
  const value = Math.trunc(Number(sourceStock));
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid stock value: ${sourceStock}`);
  }

  if (value < 0) {
    return {
      quantity: 0,
      isOutOfStock: true,
      warning: `Source stock is negative (${value}); pushed as 0.`,
    };
  }

  return { quantity: value, isOutOfStock: value === 0, warning: null };
}

export function resolveStatus({ currentStatus, isNew, isOutOfStock, outOfStockAction }) {
  if (isNew || !currentStatus) return "DRAFT";
  if (isOutOfStock && outOfStockAction === "draft") return "DRAFT";
  return currentStatus;
}
