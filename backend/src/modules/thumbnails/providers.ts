import { promises as fs } from 'fs';
import { previewKindOf } from '../files/mime.js';
import { runFfmpeg } from './ffmpeg.js';

/** Longest side, in pixels: small for the rows of a listing, large for the hover preview. */
export const THUMBNAIL_SIZES = { sm: 128, lg: 512 } as const;
export type ThumbnailSize = keyof typeof THUMBNAIL_SIZES;

const TIMEOUT_MS = 20_000;

export interface ThumbnailContext {
  ffmpeg: string;
  input: string;
  /** Where to write the finished WebP. */
  output: string;
  /** Longest side of the result, in pixels. */
  pixels: number;
}

/**
 * One way of turning a kind of file into a thumbnail. To support a new format,
 * add a provider to PROVIDERS: nothing else, on the server or in the browser,
 * needs to know about it.
 */
export interface ThumbnailProvider {
  id: string;
  supports: (name: string) => boolean;
  generate: (context: ThumbnailContext) => Promise<void>;
}

const scale = (pixels: number) => `scale=w=${pixels}:h=${pixels}:force_original_aspect_ratio=decrease`;

/** Options that keep a crafted file from reaching the network or hogging the CPU. */
const SAFE_INPUT = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-threads', '1', '-protocol_whitelist', 'file'];

const encode = (output: string, pixels: number) => [
  '-frames:v',
  '1',
  '-vf',
  scale(pixels),
  '-c:v',
  'libwebp',
  '-quality',
  '70',
  '-f',
  'webp',
  '-y',
  output,
];

/** ffmpeg can exit cleanly having written nothing (a seek past the end, say), which must not count as success. */
async function frame(ffmpeg: string, args: string[], output: string): Promise<void> {
  await runFfmpeg(ffmpeg, args, TIMEOUT_MS);
  const written = await fs.stat(output).catch(() => null);
  if (!written || written.size === 0) throw new Error('ffmpeg produced no frame');
}

const image: ThumbnailProvider = {
  id: 'image',
  supports: (name) => previewKindOf(name) === 'image',
  generate: ({ ffmpeg, input, output, pixels }) =>
    frame(ffmpeg, [...SAFE_INPUT, '-i', input, ...encode(output, pixels)], output),
};

const video: ThumbnailProvider = {
  id: 'video',
  supports: (name) => previewKindOf(name) === 'video',
  async generate({ ffmpeg, input, output, pixels }) {
    // A frame a second in usually beats the black one at zero; a clip shorter than that has none, so retry from the start.
    try {
      await frame(ffmpeg, [...SAFE_INPUT, '-ss', '1', '-i', input, ...encode(output, pixels)], output);
    } catch {
      await frame(ffmpeg, [...SAFE_INPUT, '-i', input, ...encode(output, pixels)], output);
    }
  },
};

export const PROVIDERS: ThumbnailProvider[] = [image, video];
