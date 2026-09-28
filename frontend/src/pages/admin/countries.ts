/** ISO 3166-1 alpha-2 -> flag emoji, via the regional-indicator code point trick. No image assets needed. */
export function flagEmoji(code: string): string {
  return [...code.toUpperCase()].map((c) => String.fromCodePoint(127397 + c.charCodeAt(0))).join('');
}

/** "45" as-is, "1.2k" from 1000, "1.2M" from 1e6 — keeps stat tiles from overflowing. */
export function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`;
  return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
}
