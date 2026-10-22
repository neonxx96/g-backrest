export function getUsableMarketPrice(value) {
  const price = Number(value);
  return Number.isFinite(price) && price > 0 ? price : null;
}

export function resolveAlertPriceInput(prefillPrice, currentPrice) {
  const price = getUsableMarketPrice(prefillPrice) ?? getUsableMarketPrice(currentPrice);
  return price == null ? '' : String(price);
}
