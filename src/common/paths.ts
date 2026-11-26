import { mkdirSync } from 'fs';
import { join } from 'path';

/** Where videos and the API key are kept. On a host such as Render, point STORAGE_DIR at a permanent disk. */
const STORAGE_DIR = process.env.STORAGE_DIR || process.cwd();

export const UPLOADS_DIR = join(STORAGE_DIR, 'uploads');
export const AUDIO_DIR = join(UPLOADS_DIR, 'audio');
export const SNAPSHOT_DIR = join(UPLOADS_DIR, 'snapshots');
export const DATA_DIR = join(STORAGE_DIR, 'data');

export function ensureDirs() {
  for (const dir of [UPLOADS_DIR, AUDIO_DIR, SNAPSHOT_DIR, DATA_DIR]) {
    mkdirSync(dir, { recursive: true });
  }
}
