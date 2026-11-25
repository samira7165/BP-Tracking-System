import { Logger } from '@nestjs/common';
import { existsSync, readFileSync, renameSync } from 'fs';
import { PoolConnection } from 'mysql2/promise';
import { join } from 'path';
import { DATA_DIR } from '../common/paths';
import { Recording } from '../recordings/recording.types';
import { recordingToRow } from '../recordings/recording.row';
import { Script } from '../scripts/script.types';

/**
 * One-time move of the old JSON files into MySQL. Each file is renamed to *.imported.json
 * afterwards: it stays as a backup and is never imported twice.
 */
export async function importJsonFiles(db: PoolConnection, logger: Logger) {
  const scripts = read<Script[]>('scripts.json');
  const recordings = read<Recording[]>('recordings.json');
  const prompt = read<{ reportPrompt?: string }>('settings.json')?.reportPrompt;
  if (!scripts && !recordings && !prompt) return;

  await db.beginTransaction();
  try {
    for (const s of scripts ?? []) {
      await db.query('INSERT IGNORE INTO scripts SET ?', [
        {
          id: s.id,
          title: s.title,
          text: s.text,
          language: s.language ?? null,
          active: s.active ? 1 : 0,
          created_at: new Date(s.createdAt),
          updated_at: new Date(s.updatedAt),
        },
      ]);
    }
    const [known] = await db.query('SELECT id FROM scripts');
    const ids = new Set((known as { id: string }[]).map((r) => r.id));
    for (const rec of recordings ?? []) {
      const row = recordingToRow(rec);
      // The script may have been deleted since
      if (!ids.has(row.script_id as string)) row.script_id = null;
      await db.query('INSERT IGNORE INTO recordings SET ?', [{ ...row, id: rec.id, created_at: new Date(rec.createdAt), updated_at: new Date(rec.updatedAt) }]);
    }
    if (prompt) await db.query('INSERT IGNORE INTO settings SET ?', [{ name: 'report_prompt', value: prompt }]);
    await db.commit();
  } catch (e) {
    await db.rollback();
    throw e;
  }

  if (scripts) keepAsBackup('scripts.json');
  if (recordings) keepAsBackup('recordings.json');
  if (scripts || recordings) logger.log(`Moved ${scripts?.length ?? 0} script(s) and ${recordings?.length ?? 0} recording(s) into MySQL`);
}

function read<T>(name: string): T | undefined {
  const file = join(DATA_DIR, name);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined;
}

function keepAsBackup(name: string) {
  renameSync(join(DATA_DIR, name), join(DATA_DIR, name.replace('.json', '.imported.json')));
}
