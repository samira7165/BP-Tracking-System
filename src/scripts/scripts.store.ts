import { Injectable } from '@nestjs/common';
import { DatabaseService, Row } from '../database/database.service';
import { Script } from './script.types';

@Injectable()
export class ScriptsStore {
  constructor(private readonly db: DatabaseService) {}

  /** Newest first. */
  async all(): Promise<Script[]> {
    return (await this.db.query('SELECT * FROM scripts ORDER BY created_at DESC, id')).map(toScript);
  }

  async active(): Promise<Script[]> {
    return (await this.db.query('SELECT * FROM scripts WHERE active = 1 ORDER BY created_at DESC, id')).map(toScript);
  }

  async get(id: string): Promise<Script | undefined> {
    const [row] = await this.db.query('SELECT * FROM scripts WHERE id = ?', [id]);
    return row && toScript(row);
  }

  async insert(script: Script) {
    await this.db.query('INSERT INTO scripts SET ?', [{ ...toRow(script), id: script.id, created_at: new Date(script.createdAt) }]);
  }

  async update(script: Script) {
    await this.db.query('UPDATE scripts SET ? WHERE id = ?', [toRow(script), script.id]);
  }

  async remove(id: string) {
    await this.db.query('DELETE FROM scripts WHERE id = ?', [id]);
  }
}

const toRow = (s: Script): Row => ({
  title: s.title,
  text: s.text,
  language: s.language ?? null,
  active: s.active ? 1 : 0,
  keywords: s.keywords.length ? JSON.stringify(s.keywords) : null,
  updated_at: new Date(s.updatedAt),
});

const toScript = (row: Row): Script => ({
  id: row.id,
  title: row.title,
  text: row.text,
  language: row.language || undefined,
  active: !!row.active,
  keywords: row.keywords ? JSON.parse(row.keywords) : [],
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});
