// Cost of one output (TECH-SPEC §8): derived only when both prices and both
// token counts are known; otherwise null, which the UI shows as "N/A".

const known = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

export function deriveCost(
  tokensIn: number | null | undefined, tokensOut: number | null | undefined,
  priceInPerMtok: number | null | undefined, priceOutPerMtok: number | null | undefined,
): number | null {
  if (!known(tokensIn) || !known(tokensOut) || !known(priceInPerMtok) || !known(priceOutPerMtok)) return null;
  const usd = (tokensIn * priceInPerMtok + tokensOut * priceOutPerMtok) / 1_000_000;
  // Micro-dollar precision keeps float noise out of stored values.
  return Math.round(usd * 1e6) / 1e6;
}
