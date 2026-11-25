export interface Script {
  id: string;
  title: string;
  text: string;
  /** ISO-639-1 code, e.g. "en" or "bn". Empty means auto-detect. */
  language?: string;
  /** Only active scripts are shown on the recording page. */
  active: boolean;
  createdAt: string;
  updatedAt: string;
}
