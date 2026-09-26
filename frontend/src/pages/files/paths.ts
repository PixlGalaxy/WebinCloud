import { File, FileArchive, FileText, Folder, Image, Music, Video, type LucideIcon } from 'lucide-react';

export function toFilesUrl(path: string): string {
  if (!path) return '/files';
  return `/files/${path.split('/').map(encodeURIComponent).join('/')}`;
}

const ICONS: Array<[RegExp, LucideIcon]> = [
  [/\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i, Image],
  [/\.(mp4|webm|mkv|mov|avi)$/i, Video],
  [/\.(mp3|wav|ogg|flac|m4a)$/i, Music],
  [/\.(zip|tar|gz|rar|7z)$/i, FileArchive],
  [/\.(txt|md|json|ya?ml|log|csv|pdf|[jt]sx?|css|html?|xml|sh|py|rb|go|rs|java|sql)$/i, FileText],
];

export function iconFor(type: 'file' | 'folder', name: string): LucideIcon {
  if (type === 'folder') return Folder;
  return ICONS.find(([pattern]) => pattern.test(name))?.[1] ?? File;
}

export function formatSize(bytes: number): string {
  if (bytes === 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value < 10 && exponent > 0 ? value.toFixed(1) : Math.round(value)} ${units[exponent]}`;
}
