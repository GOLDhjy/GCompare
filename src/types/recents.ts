export type RecentData = {
  files: string[];
  projects: string[];
};

export const DEFAULT_RECENTS: RecentData = {
  files: [],
  projects: [],
};

export const MAX_RECENT_FILES = 12;
export const MAX_RECENT_PROJECTS = 8;
