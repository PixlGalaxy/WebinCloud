import type { IncomingMessage, Server } from 'http';
import type { Duplex } from 'stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { AppError } from '../../errors.js';
import type { Translate } from '../../i18n/index.js';
import { logger } from '../../logger.js';
import { SOCKET_CHUNK_SIZE, writeSocketChunk } from './upload-sessions.js';

/** Session id (16 bytes) and chunk index (4 bytes) ahead of each chunk's data. */
const HEADER_BYTES = 20;
/** Upload sockets open at once across the server. */
const MAX_SOCKETS = 256;
/**
 * Chunk bytes one socket may hold in memory while they wait to be written: a
 * client keeps up to 8 MiB unacknowledged per socket. Holding them, instead of
 * waiting for each write, lets the line keep flowing through the second-long
 * pauses some file systems make while they commit (btrfs on hard disks does).
 */
const MAX_BUFFERED_PER_SOCKET = 8 * 1024 * 1024 + SOCKET_CHUNK_SIZE;
/** The same across every socket, so a burst of uploads cannot run the server out of memory. */
const MAX_BUFFERED_TOTAL = 512 * 1024 * 1024;
/** Upload sockets one user, or one visitor of a link, may hold at once (a client opens 32 per destination). */
const MAX_SOCKETS_PER_KEY = 64;
/** How often an open socket re-checks that its sign-in or link still allows uploading. */
const RECHECK_MS = 5000;
/** A socket that stores no chunk for this long is closed; clients open them again when needed. */
const IDLE_MS = 2 * 60 * 1000;
/** Refused chunks in a row before a socket is closed, so one sending only junk cannot sit on a slot. */
const MAX_FAILURES_IN_A_ROW = 20;

export const SOCKET_PATH = '/api/uploads/socket';
const PUBLIC_SOCKET = /^\/api\/public\/(.+)\/uploads\/socket$/;

/** Who an upload socket signed in as. */
export interface SocketIdentity {
  /** Must equal the owner of every session it sends chunks for. */
  owner: string;
  /** What the socket cap counts against. */
  key: string;
  /** False once the sign-in, account or link no longer allows uploading. */
  stillAllowed(): boolean;
}

export interface UploadSocketOptions {
  t: Translate;
  /**
   * Signs the handshake in: a session or device for `/api/uploads/socket`, a
   * link for `/api/public/<link>/uploads/socket` (whose path parts are passed
   * decoded). Throws an AppError to refuse it.
   */
  authenticate(req: IncomingMessage, link: string[] | null): SocketIdentity;
}

function refuse(socket: Duplex, status: number, reason: string): void {
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

/**
 * The upgrade comes from a page on this same host, or from a client that is not
 * a browser (no Origin). Host names only: the bundled nginx passes the host on
 * without its port, while a browser on a non-standard port includes it.
 */
function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  const host = (req.headers.host ?? '').replace(/:\d+$/, '').toLowerCase();
  try {
    return host !== '' && new URL(origin).hostname.toLowerCase() === host;
  } catch {
    return false;
  }
}

function formatId(bytes: Buffer): string {
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Chunked uploads over WebSockets. A browser opens at most 6 HTTP connections
 * to a site, which caps an upload far below a fast long-distance line; upload
 * sockets are not counted against that, so a client can stream chunks over
 * many connections at once.
 *
 * A socket only carries chunk data. Uploads are still opened and completed
 * over HTTP, with every check those routes make, and each chunk must belong to
 * a session of the same user or link the socket signed in as. Each binary
 * message is a 16-byte session id, a 4-byte big-endian chunk index and the
 * chunk's bytes; the server answers each with a JSON acknowledgement.
 */
export function attachUploadSocket(server: Server, options: UploadSocketOptions): void {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: HEADER_BYTES + SOCKET_CHUNK_SIZE,
    // Compressing random file data costs CPU for nothing and invites decompression bombs.
    perMessageDeflate: false,
  });
  const perKey = new Map<string, number>();
  /** Bytes received and not yet written, across every socket. */
  let bufferedTotal = 0;
  /** Sockets paused for memory, re-checked whenever a write frees some. */
  const waiting = new Set<() => void>();

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = (req.url ?? '').split('?')[0];
    let link: string[] | null = null;
    if (path !== SOCKET_PATH) {
      const match = PUBLIC_SOCKET.exec(path);
      if (!match) return refuse(socket, 404, 'Not Found');
      try {
        link = match[1].split('/').map((part) => decodeURIComponent(part));
      } catch {
        return refuse(socket, 400, 'Bad Request');
      }
    }

    // A page on another site must not be able to open a socket with this user's cookies.
    if (!sameOrigin(req)) return refuse(socket, 403, 'Forbidden');
    if (wss.clients.size >= MAX_SOCKETS) return refuse(socket, 503, 'Service Unavailable');

    let identity: SocketIdentity;
    try {
      identity = options.authenticate(req, link);
    } catch (err) {
      const status = err instanceof AppError ? err.status : 500;
      if (!(err instanceof AppError)) logger.error('Upload socket sign-in failed', err);
      return refuse(socket, status, status === 401 ? 'Unauthorized' : status === 404 ? 'Not Found' : 'Forbidden');
    }

    if ((perKey.get(identity.key) ?? 0) >= MAX_SOCKETS_PER_KEY) return refuse(socket, 429, 'Too Many Requests');

    wss.handleUpgrade(req, socket, head, (ws) => serve(ws, identity));
  });

  function serve(ws: WebSocket, identity: SocketIdentity): void {
    // Counted once the socket is really open: a handshake that fails midway never reaches here.
    perKey.set(identity.key, (perKey.get(identity.key) ?? 0) + 1);
    let checkedAt = Date.now();
    // Only chunks actually stored count as activity: junk must not keep a socket alive.
    let lastStored = Date.now();
    let failures = 0;
    let buffered = 0;
    let paused = false;

    // Reading stops while this socket, or the server as a whole, holds too much unwritten data.
    const flow = () => {
      const full = buffered > MAX_BUFFERED_PER_SOCKET || bufferedTotal > MAX_BUFFERED_TOTAL;
      if (full && !paused) {
        paused = true;
        ws.pause();
        waiting.add(flow);
      } else if (!full && paused) {
        paused = false;
        waiting.delete(flow);
        ws.resume();
      }
    };

    const idle = setInterval(() => {
      if (Date.now() - lastStored >= IDLE_MS) ws.close(1000, 'idle');
    }, 30_000);

    ws.on('close', () => {
      clearInterval(idle);
      waiting.delete(flow);
      const held = (perKey.get(identity.key) ?? 1) - 1;
      if (held > 0) perKey.set(identity.key, held);
      else perKey.delete(identity.key);
    });
    ws.on('error', () => ws.terminate());

    const reply = (body: object) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(body));
    };

    ws.on('message', (data, isBinary) => {
      if (!isBinary || !Buffer.isBuffer(data) || data.length < HEADER_BYTES) {
        ws.close(1003, 'binary chunks only');
        return;
      }

      // Signed out, deactivated, link turned off or expired: stop taking data.
      if (Date.now() - checkedAt >= RECHECK_MS) {
        if (!identity.stillAllowed()) {
          ws.close(4403, 'no longer allowed');
          return;
        }
        checkedAt = Date.now();
      }

      const id = formatId(data.subarray(0, 16));
      const index = data.readUInt32BE(16);

      // Held until written, within the limits above; acknowledged only once written.
      buffered += data.length;
      bufferedTotal += data.length;
      flow();
      writeSocketChunk(id, identity.owner, index, data.subarray(HEADER_BYTES))
        .then(() => {
          lastStored = Date.now();
          failures = 0;
          reply({ id, index, ok: true });
        })
        .catch((err: unknown) => {
          const known = err instanceof AppError;
          if (!known) logger.error('Upload socket chunk failed', err);
          reply({ id, index, status: known ? err.status : 500, error: options.t(known ? err.key : 'error.internal') });
          if (++failures >= MAX_FAILURES_IN_A_ROW) ws.close(1008, 'too many refused chunks');
        })
        .finally(() => {
          buffered -= data.length;
          bufferedTotal -= data.length;
          flow();
          // Memory freed here may let sockets paused for the server-wide limit read again.
          for (const other of [...waiting]) other();
        });
    });
  }
}
