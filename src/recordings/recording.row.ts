import { basename, join } from 'path';
import { UPLOADS_DIR } from '../common/paths';
import { Row } from '../database/database.service';
import { Recording, RecordingStatus, Report, Verdict } from './recording.types';

/** What the recordings list in the dashboard needs. */
export interface RecordingSummary {
  id: string;
  title?: string;
  speaker?: string;
  createdAt: string;
  status: RecordingStatus;
  verdict?: Verdict;
  overallScore?: number;
  error?: string;
  needsRetake?: boolean;
}

/** Columns for the fields that are present; a field set to undefined clears its columns. */
export function recordingToRow(rec: Partial<Recording>): Row {
  const row: Row = {};
  const has = (key: keyof Recording) => key in rec;
  if (has('speaker')) row.bp_name = rec.speaker ?? null;
  if (has('scriptId')) row.script_id = rec.scriptId ?? null;
  if (has('title')) row.script_title = rec.title ?? null;
  if (has('status')) row.status = rec.status;
  if (has('script')) row.script_text = rec.script;
  if (has('language')) row.script_language = rec.language ?? null;
  if (has('error')) row.error = rec.error ?? null;
  if (has('needsRetake')) row.needs_retake = rec.needsRetake ? 1 : 0;
  if (has('attempts')) row.attempts = rec.attempts ?? 0;
  if (has('queuedAt')) row.queued_at = rec.queuedAt ? new Date(rec.queuedAt) : null;
  if (has('transcript')) {
    const t = rec.transcript;
    row.transcript = t?.text ?? null;
    row.transcript_language = t?.language ?? null;
    row.transcript_model = t?.model ?? null;
    row.transcript_segments = t?.segments.length ? JSON.stringify(t.segments) : null;
    row.duration_sec = t?.durationSec ?? null;
  }
  if (has('report')) {
    const r = rec.report;
    row.report = r ? JSON.stringify(r) : null;
    row.verdict = r?.verdict ?? null;
    row.overall_score = r?.overallScore ?? null;
    row.word_accuracy = r?.wordAccuracy ?? null;
    row.summary = r?.summary ?? null;
  }
  if (rec.video) {
    row.video_file = rec.video.fileName;
    row.video_mime = rec.video.mimeType.slice(0, 100);
    row.video_size = rec.video.sizeBytes;
    row.video_original_name = (rec.video.originalName ?? '').slice(0, 255);
  }
  return row;
}

export function rowToRecording(row: Row): Recording {
  // Only a file name: a path typed into the database must not reach outside uploads/
  const fileName = basename(row.video_file);
  return {
    id: row.id,
    title: row.script_title ?? undefined,
    scriptId: row.script_id ?? undefined,
    speaker: row.bp_name ?? undefined,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    status: row.status,
    script: row.script_text,
    language: row.script_language ?? undefined,
    video: {
      fileName,
      path: join(UPLOADS_DIR, fileName),
      mimeType: row.video_mime,
      sizeBytes: Number(row.video_size),
      originalName: row.video_original_name,
    },
    transcript:
      row.transcript === null
        ? undefined
        : {
            text: row.transcript,
            language: row.transcript_language ?? undefined,
            durationSec: row.duration_sec ?? undefined,
            segments: row.transcript_segments ? JSON.parse(row.transcript_segments) : [],
            model: row.transcript_model ?? '',
          },
    report: row.report ? (JSON.parse(row.report) as Report) : undefined,
    error: row.error ?? undefined,
    needsRetake: !!row.needs_retake,
    attempts: row.attempts,
    queuedAt: row.queued_at?.toISOString(),
  };
}

export function rowToSummary(row: Row): RecordingSummary {
  return {
    id: row.id,
    title: row.script_title ?? undefined,
    speaker: row.bp_name ?? undefined,
    createdAt: row.created_at.toISOString(),
    status: row.status,
    verdict: row.verdict ?? undefined,
    overallScore: row.overall_score ?? undefined,
    error: row.error ?? undefined,
    needsRetake: !!row.needs_retake,
  };
}
