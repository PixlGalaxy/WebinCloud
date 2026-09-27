import { File, FileArchive, FileText, Folder, Image, Music, Video, type LucideIcon } from 'lucide-react';
import wordLogo from '../../assets/word-256x256.webp';
import excelLogo from '../../assets/excel-256x256.webp';
import powerpointLogo from '../../assets/powerpoint-256x256.webp';
import accessLogo from '../../assets/access-256x256.webp';
import projectLogo from '../../assets/project-256x256.webp';
import visioLogo from '../../assets/visio-256x256.webp';

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

export type OfficeFamily = 'word' | 'excel' | 'powerpoint' | 'access' | 'project' | 'visio';

/**
 * Legacy binary formats (.doc, .xls, .ppt, .mdb, .vsd) share the same family
 * as their modern equivalent — one entry per family, not per extension.
 * None of access/project/visio have an in-browser preview (see PreviewPanel),
 * so this only ever drives which icon is shown, never what happens on click.
 */
const OFFICE_PATTERNS: Array<[RegExp, OfficeFamily]> = [
  [/\.docx?$|\.docm$|\.dotx?$/i, 'word'],
  [/\.xlsx?$|\.xlsm$|\.xltx?$|\.xlsb$|\.ods$/i, 'excel'],
  [/\.pptx?$|\.pptm$|\.ppsx$/i, 'powerpoint'],
  [/\.accdb$|\.accde$|\.accdt$|\.accdr$|\.mdb$|\.mde$/i, 'access'],
  [/\.mpp$|\.mpt$|\.mpx$/i, 'project'],
  [/\.vsdx?$|\.vsdm$|\.vssx$|\.vstx$|\.vdx$/i, 'visio'],
];

const OFFICE_LOGOS: Record<OfficeFamily, string> = {
  word: wordLogo,
  excel: excelLogo,
  powerpoint: powerpointLogo,
  access: accessLogo,
  project: projectLogo,
  visio: visioLogo,
};

export function officeFamilyOf(type: 'file' | 'folder', name: string): OfficeFamily | null {
  if (type === 'folder') return null;
  return OFFICE_PATTERNS.find(([pattern]) => pattern.test(name))?.[1] ?? null;
}

export function officeLogoFor(family: OfficeFamily): string {
  return OFFICE_LOGOS[family];
}

export function formatSize(bytes: number): string {
  if (bytes === 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value < 10 && exponent > 0 ? value.toFixed(1) : Math.round(value)} ${units[exponent]}`;
}
