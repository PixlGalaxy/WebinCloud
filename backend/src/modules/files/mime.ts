import { extname } from 'path';

export type PreviewKind = 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'html' | 'spreadsheet' | 'document' | 'none';

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
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xlsm': 'application/vnd.ms-excel.sheet.macroEnabled.12',
  '.xltx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.template',
  '.xlsb': 'application/vnd.ms-excel.sheet.binary.macroEnabled.12',
  '.xls': 'application/vnd.ms-excel',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.docm': 'application/vnd.ms-word.document.macroEnabled.12',
  '.dotx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
};

// Legacy .doc (binary Word), .ppt/.pptx and Access databases have no solid
// pure-JS renderer yet, so they stay downloadable only. Add an entry here
// once one covers them — everything else already routes through this map.
const SPREADSHEET_EXTENSIONS = new Set(['.xlsx', '.xlsm', '.xltx', '.xlsb', '.xls', '.ods']);
const DOCUMENT_EXTENSIONS = new Set(['.docx', '.docm', '.dotx']);

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.log', '.csv', '.tsv', '.json', '.yaml', '.yml', '.toml', '.ini',
  '.conf', '.env', '.xml', '.html', '.htm', '.css', '.scss', '.less', '.js', '.jsx', '.ts', '.tsx',
  '.mjs', '.cjs', '.py', '.rb', '.go', '.rs', '.java', '.kt', '.c', '.h', '.cpp', '.hpp', '.cs',
  '.php', '.sh', '.bash', '.zsh', '.ps1', '.sql', '.gitignore', '.dockerfile', '.tf', '.svg',
]);

/**
 * Extension-less names (.gitkeep, LICENSE, Dockerfile) are treated as text.
 * Both helpers below go through this, so what is previewable and what is
 * served inline can never disagree.
 */
function isTextExtension(ext: string): boolean {
  return ext === '' || TEXT_EXTENSIONS.has(ext);
}

export function inlineMimeOf(name: string): string | null {
  const ext = extname(name).toLowerCase();
  const direct = INLINE_MIME[ext];
  if (direct) return direct;

  // Text-ish files are always announced as text/plain, never text/html or
  // image/svg+xml, so the browser displays them instead of running them.
  if (isTextExtension(ext)) return 'text/plain; charset=utf-8';
  return null;
}

export function previewKindOf(name: string): PreviewKind {
  const ext = extname(name).toLowerCase();
  const mime = INLINE_MIME[ext];

  if (mime?.startsWith('image/')) return 'image';
  if (mime?.startsWith('video/')) return 'video';
  if (mime?.startsWith('audio/')) return 'audio';
  if (mime === 'application/pdf') return 'pdf';
  if (SPREADSHEET_EXTENSIONS.has(ext)) return 'spreadsheet';
  if (DOCUMENT_EXTENSIONS.has(ext)) return 'document';
  if (ext === '.html' || ext === '.htm') return 'html';
  if (isTextExtension(ext)) return 'text';
  return 'none';
}

// html is still served and edited as plain text (see inlineMimeOf); it only
// gets its own PreviewKind so the frontend can offer a live-rendered view too.
export function isTextFile(name: string): boolean {
  const kind = previewKindOf(name);
  return kind === 'text' || kind === 'html';
}
