import { Store } from '@tauri-apps/plugin-store';
import type { AppSettings } from '../types/settings';
import { DEFAULT_SETTINGS } from '../types/settings';

const SETTINGS_PATH = 'settings.json';
let store: Store | null = null;

export async function initStore(): Promise<void> {
  if (!store) {
    store = await Store.load(SETTINGS_PATH);
  }
}

export async function getSettings(): Promise<AppSettings> {
  try {
    await initStore();
    const saved = await store?.get<AppSettings>('settings');
    return saved || DEFAULT_SETTINGS;
  } catch (error) {
    console.error('Failed to load settings:', error);
    return DEFAULT_SETTINGS;
  }
}

export async function updateSettings(
  updates: Partial<AppSettings>,
): Promise<void> {
  try {
    await initStore();
    const current = await getSettings();
    const updated = { ...current, ...updates };
    await store?.set('settings', updated);
    await store?.save();
  } catch (error) {
    console.error('Failed to save settings:', error);
    throw error;
  }
}

export async function resetSettings(): Promise<void> {
  try {
    await initStore();
    await store?.delete('settings');
    await store?.save();
  } catch (error) {
    console.error('Failed to reset settings:', error);
    throw error;
  }
}
