import type { Request } from 'express';
import { isLoopbackOrPrivate, isValidIp } from '../admin/ip-bans.service.js';

/** Headers a proxy uses to pass on who it is forwarding for. */
const FORWARDING_HEADERS = ['x-forwarded-for', 'x-real-ip', 'cf-connecting-ip', 'true-client-ip'];

/** "[::1]:443", "1.2.3.4:80", "::ffff:10.0.0.2" or "fe80::1%eth0", as sockets and proxies write them, down to the address. */
function bareAddress(value: string): string {
  let v = value.trim().replace(/^"|"$/g, '');
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(v);
  if (bracketed) v = bracketed[1];
  const v4WithPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(v);
  if (v4WithPort) v = v4WithPort[1];
  return v.replace(/^::ffff:(?=\d)/i, '').replace(/%.*$/, '');
}

/**
 * Whether the request comes from the server's own network, judged by every
 * address it carries rather than `req.ip`. Until the trusted proxies are set,
 * `req.ip` behind a reverse proxy is the proxy's LAN address for everyone; the
 * forwarding headers still hold the visitor's real one, which a client can add
 * fake entries next to but not remove. Anything unreadable counts as outside.
 */
export function isFromLocalNetwork(req: Request): boolean {
  const addresses = [req.socket.remoteAddress ?? ''];

  for (const name of FORWARDING_HEADERS) {
    const value = req.headers[name];
    for (const line of Array.isArray(value) ? value : value ? [value] : []) addresses.push(...line.split(','));
  }

  const forwarded = req.headers.forwarded;
  if (forwarded) {
    for (const match of forwarded.matchAll(/for=("[^"]*"|[^;,\s]+)/gi)) addresses.push(match[1]);
  }

  return addresses.every((raw) => {
    const ip = bareAddress(raw);
    return isValidIp(ip) && isLoopbackOrPrivate(ip);
  });
}
