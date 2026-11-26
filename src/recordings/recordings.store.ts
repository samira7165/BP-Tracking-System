import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { RecordingSummary, recordingToRow, rowToRecording, rowToSummary } from './recording.row';
import { Recording } from './recording.types';

@Injectable()
export class RecordingsStore {
  constructor(private readonly db: DatabaseService) {}

  /** Newest first, without the long texts. */
  async list(): Promise<RecordingSummary[]> {
    const rows = await this.db.query(
      `SELECT id, script_title, bp_name, created_at, status, verdict, overall_score, appearance_score, error, needs_retake
       FROM recordings ORDER BY created_at DESC, id`,
    );
    return rows.map(rowToSummary);
  }

  async get(id: string): Promise<Recording | undefined> {
    const [row] = await this.db.query('SELECT * FROM recordings WHERE id = ?', [id]);
    return row && rowToRecording(row);
  }

  /** Waiting or interrupted, in the order they joined the line. */
  unfinished(): Promise<{ id: string; attempts: number }[]> {
    return this.db.query(`SELECT id, attempts FROM recordings WHERE status NOT IN ('done', 'failed') ORDER BY COALESCE(queued_at, created_at), id`);
  }

  async insert(rec: Recording) {
    await this.db.query('INSERT INTO recordings SET ?', [
      { ...recordingToRow(rec), id: rec.id, created_at: new Date(rec.createdAt), updated_at: new Date(rec.updatedAt) },
    ]);
  }

  async update(id: string, patch: Partial<Recording>) {
    await this.db.query('UPDATE recordings SET ? WHERE id = ?', [{ ...recordingToRow(patch), updated_at: new Date() }, id]);
  }

  async remove(id: string) {
    await this.db.query('DELETE FROM recordings WHERE id = ?', [id]);
  }
}
