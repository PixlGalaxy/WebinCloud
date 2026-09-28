/**
 * Approximate country centroids (lat, lng) for plotting a dot per country on
 * the world map. Not exhaustive — GeoLite2 can return any ISO 3166-1 code —
 * but covers the countries this app's audience is realistically connecting
 * from. A code missing here just doesn't get a dot; add it as needed.
 */
export const COUNTRY_CENTROIDS: Record<string, [number, number]> = {
  US: [39.8, -98.6], CA: [56.1, -106.3], MX: [23.6, -102.5],
  BR: [-14.2, -51.9], AR: [-38.4, -63.6], CL: [-35.7, -71.5], CO: [4.6, -74.3],
  PE: [-9.2, -75.0], VE: [6.4, -66.6], EC: [-1.8, -78.2], BO: [-16.3, -63.6],
  PY: [-23.4, -58.4], UY: [-32.5, -55.8], CU: [21.5, -77.8], DO: [18.7, -70.2],
  GT: [15.8, -90.2], HN: [15.2, -86.2], SV: [13.8, -88.9], NI: [12.9, -85.2],
  CR: [9.7, -83.8], PA: [8.5, -80.8], JM: [18.1, -77.3], PR: [18.2, -66.6],

  GB: [55.4, -3.4], IE: [53.4, -8.2], FR: [46.6, 2.2], DE: [51.2, 10.5],
  ES: [40.5, -3.7], PT: [39.4, -8.2], IT: [42.5, 12.6], NL: [52.1, 5.3],
  BE: [50.5, 4.5], LU: [49.8, 6.1], CH: [46.8, 8.2], AT: [47.5, 14.6],
  PL: [51.9, 19.1], CZ: [49.8, 15.5], SK: [48.7, 19.7], HU: [47.2, 19.5],
  RO: [45.9, 25.0], BG: [42.7, 25.5], GR: [39.1, 21.8], TR: [38.9, 35.2],
  SE: [60.1, 18.6], NO: [60.5, 8.5], DK: [56.3, 9.5], FI: [61.9, 25.7],
  IS: [64.9, -19.0], EE: [58.6, 25.0], LV: [56.9, 24.6], LT: [55.2, 23.9],
  UA: [48.4, 31.2], RU: [61.5, 105.3], BY: [53.7, 27.9], MD: [47.4, 28.4],
  RS: [44.0, 21.0], HR: [45.1, 15.2], SI: [46.1, 14.8], BA: [43.9, 17.7],
  MK: [41.6, 21.7], AL: [41.2, 20.2], CY: [35.1, 33.4], MT: [35.9, 14.4],
  GE: [42.3, 43.4], AM: [40.1, 45.0], AZ: [40.1, 47.6],

  IN: [22.4, 78.7], CN: [35.9, 104.2], JP: [36.2, 138.3], KR: [35.9, 127.8],
  TW: [23.7, 121.0], HK: [22.3, 114.2], SG: [1.35, 103.8], MY: [4.2, 101.9],
  TH: [15.9, 100.9], VN: [14.1, 108.3], PH: [12.9, 121.8], ID: [-0.8, 113.9],
  PK: [30.4, 69.3], BD: [23.7, 90.4], LK: [7.9, 80.8], NP: [28.4, 84.1],
  KZ: [48.0, 66.9], UZ: [41.4, 64.6], MN: [46.9, 103.8],
  SA: [23.9, 45.1], AE: [23.4, 53.8], IL: [31.0, 34.9], IQ: [33.2, 43.7],
  IR: [32.4, 53.7], JO: [30.6, 36.2], LB: [33.9, 35.9], QA: [25.4, 51.2],
  KW: [29.3, 47.5], OM: [21.5, 55.9],

  AU: [-25.3, 133.8], NZ: [-41.0, 174.9],

  ZA: [-30.6, 22.9], EG: [26.8, 30.8], NG: [9.1, 8.7], KE: [-0.02, 37.9],
  MA: [31.8, -7.1], DZ: [28.0, 1.7], TN: [33.9, 9.5], GH: [7.9, -1.0],
  ET: [9.1, 40.5], TZ: [-6.4, 34.9], UG: [1.4, 32.3],
};

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
