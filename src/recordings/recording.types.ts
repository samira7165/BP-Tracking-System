export type RecordingStatus =
  | 'queued'
  | 'extracting_audio'
  | 'transcribing'
  | 'analyzing'
  | 'done'
  | 'failed';

export interface TranscriptSegment {
  start: number; // seconds
  end: number; // seconds
  text: string;
}

export interface Transcript {
  text: string;
  language?: string;
  durationSec?: number;
  segments: TranscriptSegment[];
  model: string;
}

export type DiffType = 'match' | 'missing' | 'extra' | 'changed';

export interface DiffChunk {
  type: DiffType;
  /** Words from the script (match / missing / changed) */
  expected?: string;
  /** Words actually spoken (match / extra / changed) */
  spoken?: string;
}

export type Verdict = 'MATCHED' | 'PARTIALLY_MATCHED' | 'NOT_MATCHED';

export interface Report {
  verdict: Verdict;
  /** 0-100 score from the AI (or the word accuracy if AI was unavailable) */
  overallScore: number;
  /** 0-100, purely word-by-word comparison */
  wordAccuracy: number;
  stats: {
    scriptWords: number;
    spokenWords: number;
    matchedWords: number;
    missingWords: number;
    extraWords: number;
    changedWords: number;
  };
  summary: string;
  missingParts: string[];
  addedParts: string[];
  changedParts: { expected: string; spoken: string; note?: string }[];
  suggestions: string[];
  diff: DiffChunk[];
  generatedBy: 'ai+local' | 'local-only';
  analysisModel?: string;
  warning?: string;
  generatedAt: string;
}

export interface Recording {
  id: string;
  /** Title of the script at the time of recording */
  title?: string;
  scriptId?: string;
  speaker?: string;
  createdAt: string;
  updatedAt: string;
  status: RecordingStatus;
  /** Copy of the script text, so later edits don't change old reports */
  script: string;
  language?: string;
  video: {
    fileName: string;
    path: string;
    mimeType: string;
    sizeBytes: number;
    originalName: string;
  };
  transcript?: Transcript;
  report?: Report;
  error?: string;
  /** The recording itself is unusable, so the brand promoter has to record again */
  needsRetake?: boolean;
  /** When it joined the line; decides the order after a restart */
  queuedAt?: string;
  /** How often processing was started; stops a take that keeps crashing the server */
  attempts?: number;
}
