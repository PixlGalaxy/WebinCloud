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

// One muted, non-office color per category, chosen so none of them repeats a
// bright/neon hue: everything sits in the 500-600 Tailwind range.
const ICONS: Array<[RegExp, LucideIcon, string]> = [
  [/\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i, Image, 'text-violet-500 dark:text-violet-400'],
  [/\.(mp4|webm|mkv|mov|avi)$/i, Video, 'text-orange-500 dark:text-orange-400'],
  [/\.(mp3|wav|ogg|flac|m4a)$/i, Music, 'text-pink-500 dark:text-pink-400'],
  [/\.(zip|tar|gz|rar|7z)$/i, FileArchive, 'text-amber-600 dark:text-amber-500'],
  [/\.pdf$/i, FileText, 'text-rose-600 dark:text-rose-500'],
  [/\.html?$/i, FileText, 'text-cyan-600 dark:text-cyan-500'],
  [
    /\.(txt|md|json|ya?ml|log|csv|[jt]sx?|css|xml|sh|py|rb|go|rs|java|sql)$/i,
    FileText,
    'text-slate-400 dark:text-slate-500',
  ],
];

export function iconFor(type: 'file' | 'folder', name: string): LucideIcon {
  if (type === 'folder') return Folder;
  return ICONS.find(([pattern]) => pattern.test(name))?.[1] ?? File;
}

// A file whose extension matches nothing above still gets a fixed color, not
// the caller's — same treatment as every recognized category.
const DEFAULT_FILE_COLOR = 'text-slate-600 dark:text-white';

/** Fixed color for a file, whatever its extension; null for folders, which keep the caller's own color. */
export function iconColorFor(type: 'file' | 'folder', name: string): string | null {
  if (type === 'folder') return null;
  return ICONS.find(([pattern]) => pattern.test(name))?.[2] ?? DEFAULT_FILE_COLOR;
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
