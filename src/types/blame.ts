export interface BlameEntry {
  line: number;
  hash: string;
  author: string;
  timestamp: number;
  summary: string;
}

export interface BlameResult {
  provider: string;
  entries: BlameEntry[];
}
