import { readFileSync } from 'fs';

/**
 * Cumulative received/transmitted bytes for the container's main network
 * interface, straight from the kernel (`/proc/net/dev`, Linux only). This is
 * whole-container traffic — nginx's static assets and every proxied request
 * included — the same thing a NIC widget like Unraid's graphs, rather than
 * just the bytes this app's own handlers moved. Returns null off Linux (e.g.
 * Windows dev) or if the file is ever missing/unreadable.
 */
export function readInterfaceCounters(): { rx: number; tx: number } | null {
  let text: string;
  try {
    text = readFileSync('/proc/net/dev', 'utf-8');
  } catch {
    return null;
  }

  // First two lines are headers; each following line is "iface: rx... tx...".
  for (const line of text.split('\n').slice(2)) {
    const [ifaceRaw, rest] = line.split(':');
    const iface = ifaceRaw?.trim();
    if (!iface || iface === 'lo' || !rest) continue;

    const fields = rest.trim().split(/\s+/).map(Number);
    const rx = fields[0];
    const tx = fields[8];
    if (Number.isFinite(rx) && Number.isFinite(tx)) return { rx: rx!, tx: tx! };
  }
  return null;
}
