export interface P4Settings {
  port: string;  // P4PORT
  user: string;  // P4USER
  client: string;  // P4CLIENT
}

export interface AppSettings {
  theme: 'system' | 'light' | 'dark';
  viewMode: 'side-by-side' | 'inline';
  p4?: P4Settings;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  viewMode: 'side-by-side',
};
