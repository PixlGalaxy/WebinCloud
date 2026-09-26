import { extname } from 'path';

export type PreviewKind = 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'none';

/** Types safe to serve inline; anything else is downloaded as an attachment. */
const INLINE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.pdf': 'application/pdf',
};

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.log', '.csv', '.tsv', '.json', '.yaml', '.yml', '.toml', '.ini',
  '.conf', '.env', '.xml', '.html', '.htm', '.css', '.scss', '.less', '.js', '.jsx', '.ts', '.tsx',
  '.mjs', '.cjs', '.py', '.rb', '.go', '.rs', '.java', '.kt', '.c', '.h', '.cpp', '.hpp', '.cs',
  '.php', '.sh', '.bash', '.zsh', '.ps1', '.sql', '.gitignore', '.dockerfile', '.tf', '.svg',
]);

export function inlineMimeOf(name: string): string | null {
  const ext = extname(name).toLowerCase();
  const direct = INLINE_MIME[ext];
  if (direct) return direct;

  // Text-ish files are always announced as text/plain, never text/html or
  // image/svg+xml, so the browser displays them instead of running them.
  if (TEXT_EXTENSIONS.has(ext)) return 'text/plain; charset=utf-8';
  return null;
}

export function previewKindOf(name: string): PreviewKind {
  const ext = extname(name).toLowerCase();
  const mime = INLINE_MIME[ext];

  if (mime?.startsWith('image/')) return 'image';
  if (mime?.startsWith('video/')) return 'video';
  if (mime?.startsWith('audio/')) return 'audio';
  if (mime === 'application/pdf') return 'pdf';
  if (TEXT_EXTENSIONS.has(ext) || ext === '') return 'text';
  return 'none';
}

export function isTextFile(name: string): boolean {
  return previewKindOf(name) === 'text';
}
