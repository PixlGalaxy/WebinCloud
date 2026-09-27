import { execFile } from 'child_process';

/** Runs ffmpeg without a shell, killing it if it takes too long. */
export function runFfmpeg(bin: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr.trim().split('\n').pop() || err.message));
      else resolve(stdout);
    });
  });
}
