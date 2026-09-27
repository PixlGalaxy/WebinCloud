type Level = 'INFO' | 'WARN' | 'ERROR';

// The container prefixes nginx output with [FRONTEND], so `docker logs` reads as one stream.
const BACKEND = '[BACKEND]';
const AUTH = '[AUTH]';
const SYSTEM = '[SYSTEM]';

function write(prefix: string, level: Level, message: string, detail?: unknown) {
  const line = `${prefix} ${new Date().toISOString()} ${level.padEnd(5)} ${message}`;
  const stream = level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : console.log;
  if (detail === undefined) stream(line);
  else stream(line, detail);
}

const channel = (prefix: string) => ({
  info: (message: string) => write(prefix, 'INFO', message),
  warn: (message: string) => write(prefix, 'WARN', message),
});

export const logger = {
  info: (message: string, detail?: unknown) => write(BACKEND, 'INFO', message, detail),
  warn: (message: string, detail?: unknown) => write(BACKEND, 'WARN', message, detail),
  error: (message: string, detail?: unknown) => write(BACKEND, 'ERROR', message, detail),
  /** Sign-ins, sign-outs and password changes. */
  auth: channel(AUTH),
  /** Changes to files and shares, by whoever made them. */
  system: channel(SYSTEM),
};
