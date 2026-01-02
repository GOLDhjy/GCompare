export interface AppSettings {
  theme: 'system' | 'light' | 'dark';
  viewMode: 'side-by-side' | 'inline';
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  viewMode: 'side-by-side',
};
