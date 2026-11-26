export type RecordingStatus =
  | 'queued'
  | 'extracting_audio'
  | 'transcribing'
  | 'checking_snapshots'
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

type Rating = { rating: 'good' | 'fair' | 'poor'; note: string };

/** A picture taken from the video: number 1-3 and where in the video, in seconds. */
export interface Snapshot {
  n: number;
  atSec: number;
}

/** What Gemini saw in the 3 snapshots. Only "error" is set when the check could not be done. */
export interface Appearance {
  snapshots: Snapshot[];
  error?: string;
  personVisible?: boolean;
  score?: number;
  summary?: string;
  aspects?: Record<'attire' | 'expression' | 'bodyLanguage', Rating>;
  strengths?: string[];
  improvements?: string[];
}

/** Was a required keyword said? "exact" = found by code, "ai" = the AI heard it said differently. */
export interface KeywordResult {
  keyword: string;
  said: boolean;
  how: 'exact' | 'ai';
  heardAs?: string;
}

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
  appearance?: Appearance;
  keywords?: KeywordResult[];
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
  /** Copy of the script's keywords at the time of recording */
  keywords?: string[];
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
