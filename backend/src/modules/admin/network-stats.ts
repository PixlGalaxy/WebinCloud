import { readFileSync } from 'fs';

/**
 * Cumulative received/transmitted bytes over the container's network
 * interfaces, straight from the kernel (`/proc/net/dev`, Linux only). This is
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
  // Every interface but loopback is summed: the kernel can list idle tunnel
  // devices (tunl0, sit0, ...) ahead of eth0, and a container on several
  // networks has traffic on each.
  let rx = 0;
  let tx = 0;
  let found = false;
  for (const line of text.split('\n').slice(2)) {
    const [ifaceRaw, rest] = line.split(':');
    const iface = ifaceRaw?.trim();
    if (!iface || iface === 'lo' || !rest) continue;

    const fields = rest.trim().split(/\s+/).map(Number);
    if (!Number.isFinite(fields[0]) || !Number.isFinite(fields[8])) continue;
    rx += fields[0]!;
    tx += fields[8]!;
    found = true;
  }
  return found ? { rx, tx } : null;
}
