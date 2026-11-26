// Pricing rule: sourcePrice * (1 + markup%), rounded UP to the next whole dollar.
// Example: 10.00 at 85% -> 18.50 -> 19. Exact whole values stay as they are (20.00 at 85% -> 37).

export function calculatePrice(sourcePrice, markupPercent) {
  const source = Number(sourcePrice);
  const markup = Number(markupPercent);

  if (!Number.isFinite(source) || source < 0) {
    throw new Error(`Invalid source price: ${sourcePrice}`);
  }
  if (!Number.isFinite(markup) || markup < 0) {
    throw new Error(`Invalid markup percentage: ${markupPercent}`);
  }

  // toFixed(6) removes floating point noise (e.g. 20 * 1.85 = 37.00000000000001)
  // before rounding up.
  const raw = Number((source * (1 + markup / 100)).toFixed(6));
  return Math.ceil(raw);
}

export function formatMoney(amount) {
  return Number(amount).toFixed(2);
}
