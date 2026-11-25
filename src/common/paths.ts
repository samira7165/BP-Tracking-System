import { mkdirSync } from 'fs';
import { join } from 'path';

export const UPLOADS_DIR = join(process.cwd(), 'uploads');
export const AUDIO_DIR = join(UPLOADS_DIR, 'audio');
export const DATA_DIR = join(process.cwd(), 'data');

export function ensureDirs() {
  for (const dir of [UPLOADS_DIR, AUDIO_DIR, DATA_DIR]) {
    mkdirSync(dir, { recursive: true });
  }
}
