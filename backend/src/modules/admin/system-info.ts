import { readFileSync, existsSync, statfsSync } from 'fs';
import os from 'os';
import type { EnvConfig } from '../../config/env.js';

export interface ImageInfo {
  nodeVersion: string;
  appVersion: string;
  /** The published tag (e.g. "latest", "1.2.3") — see the ARG in the Dockerfile's final stage. */
  imageRef: string;
  /** Short commit hash, if the publish workflow set one. */
  imageRevision?: string;
  platform: string;
  arch: string;
  osRelease: string;
  containerized: boolean;
}

export interface DiskUsage {
  label: string;
  path: string;
  totalBytes: number;
  usedBytes: number;
}

export function getImageInfo(config: EnvConfig): ImageInfo {
  return {
    nodeVersion: process.version,
    appVersion: config.BACKEND_VERSION,
    imageRef: config.IMAGE_REF,
    imageRevision: config.IMAGE_REVISION?.slice(0, 7),
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    containerized: isContainerized(),
  };
}

/** `os.cpus()` reports the real model name on every platform (Linux, Windows, macOS) — no cgroup or Docker needed. */
export function getCpuModel(): string | null {
  const model = os.cpus()[0]?.model?.trim();
  return model && model.length > 0 ? model : null;
}

/** `/.dockerenv` is created by the Docker runtime itself; `/proc/1/cgroup` mentioning "docker" is the fallback for setups that skip it. */
export function isContainerized(): boolean {
  if (existsSync('/.dockerenv')) return true;
  try {
    return readFileSync('/proc/1/cgroup', 'utf-8').includes('docker');
  } catch {
    return false;
  }
}

/** Effective CPU budget — the cgroup quota if capped (e.g. `docker run --cpus=2`), otherwise every core the host exposes. */
export function getCpuCoreLimit(): number {
  try {
    // cgroup v2: "<quota> <period>" in microseconds, or "max <period>" when uncapped.
    const [quota, period] = readFileSync('/sys/fs/cgroup/cpu.max', 'utf-8').trim().split(/\s+/);
    if (quota !== 'max') {
      const cores = Number(quota) / Number(period);
      if (Number.isFinite(cores) && cores > 0) return cores;
    }
  } catch {
    // Not cgroup v2 — fall through to v1.
  }
  try {
    const quota = Number(readFileSync('/sys/fs/cgroup/cpu/cpu.cfs_quota_us', 'utf-8').trim());
    const period = Number(readFileSync('/sys/fs/cgroup/cpu/cpu.cfs_period_us', 'utf-8').trim());
    if (quota > 0 && period > 0) return quota / period;
  } catch {
    // Not cgroup v1 either, or uncapped — use every host core.
  }
  return os.cpus().length;
}

/** Cumulative CPU time this container has used, in microseconds. `null` off Linux — the caller diffs two samples over time to get a percentage. */
export function readCgroupCpuUsageMicros(): number | null {
  try {
    const match = /usage_usec (\d+)/.exec(readFileSync('/sys/fs/cgroup/cpu.stat', 'utf-8'));
    if (match) return Number(match[1]);
  } catch {
    // Not cgroup v2 — fall through to v1.
  }
  try {
    return Number(readFileSync('/sys/fs/cgroup/cpuacct/cpuacct.usage', 'utf-8').trim()) / 1000;
  } catch {
    return null;
  }
}

// cgroup v1 reports a near-int64-max sentinel for "no memory limit", not a real byte count.
const UNLIMITED_MEMORY_SENTINEL = 1e15;

/** Container memory limit and actual usage — page cache excluded, the same way `docker stats` computes it. `null` off Linux. */
export function readCgroupMemory(): { totalBytes: number; usedBytes: number } | null {
  try {
    const limitRaw = readFileSync('/sys/fs/cgroup/memory.max', 'utf-8').trim();
    const usage = Number(readFileSync('/sys/fs/cgroup/memory.current', 'utf-8').trim());
    const cacheMatch = /inactive_file (\d+)/.exec(readFileSync('/sys/fs/cgroup/memory.stat', 'utf-8'));
    const cache = cacheMatch ? Number(cacheMatch[1]) : 0;
    return {
      totalBytes: limitRaw === 'max' ? os.totalmem() : Number(limitRaw),
      usedBytes: Math.max(0, usage - cache),
    };
  } catch {
    // Not cgroup v2 — fall through to v1.
  }
  try {
    const limitRaw = Number(readFileSync('/sys/fs/cgroup/memory/memory.limit_in_bytes', 'utf-8').trim());
    const usage = Number(readFileSync('/sys/fs/cgroup/memory/memory.usage_in_bytes', 'utf-8').trim());
    const cacheMatch = /^cache (\d+)/m.exec(readFileSync('/sys/fs/cgroup/memory/memory.stat', 'utf-8'));
    const cache = cacheMatch ? Number(cacheMatch[1]) : 0;
    return {
      totalBytes: limitRaw > UNLIMITED_MEMORY_SENTINEL ? os.totalmem() : limitRaw,
      usedBytes: Math.max(0, usage - cache),
    };
  } catch {
    return null;
  }
}

/** Filesystem usage for a mounted path. Works cross-platform (Node's statfs has a Windows implementation too), so this is shown even in local dev. */
export function readDiskUsage(label: string, path: string): DiskUsage | null {
  try {
    const stats = statfsSync(path);
    const totalBytes = stats.blocks * stats.bsize;
    const freeBytes = stats.bfree * stats.bsize;
    return { label, path, totalBytes, usedBytes: Math.max(0, totalBytes - freeBytes) };
  } catch {
    return null;
  }
}
