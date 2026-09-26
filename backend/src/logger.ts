type Level = 'INFO' | 'WARN' | 'ERROR';

// The container prefixes nginx output with [FRONTEND], so `docker logs` reads as one stream.
const PREFIX = '[BACKEND]';

function write(level: Level, message: string, detail?: unknown) {
  const line = `${PREFIX} ${new Date().toISOString()} ${level.padEnd(5)} ${message}`;
  const stream = level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : console.log;
  if (detail === undefined) stream(line);
  else stream(line, detail);
}

export const logger = {
  info: (message: string, detail?: unknown) => write('INFO', message, detail),
  warn: (message: string, detail?: unknown) => write('WARN', message, detail),
  error: (message: string, detail?: unknown) => write('ERROR', message, detail),
};
