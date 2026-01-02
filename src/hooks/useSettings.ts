import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { AppSettings } from '../types/settings';
import { getSettings, updateSettings as updateSettingsStore } from '../services/settingsStore';

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>({
    theme: 'system',
    viewMode: 'side-by-side',
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getSettings()
      .then(async (loadedSettings) => {
        setSettings(loadedSettings);
        // 同步初始菜单状态
        try {
          await invoke('update_theme_menu', { theme: loadedSettings.theme });
        } catch (error) {
          console.error('Failed to update menu state:', error);
        }
      })
      .catch((error) => {
        console.error('Failed to load settings:', error);
      })
      .finally(() => setLoading(false));
  }, []);

  const updateTheme = async (theme: AppSettings['theme']) => {
    try {
      await updateSettingsStore({ theme });
      setSettings((prev) => ({ ...prev, theme }));
      // 注意：菜单状态同步现在由 Rust 端的 on_menu_event 处理
    } catch (error) {
      console.error('Failed to update theme:', error);
      throw error;
    }
  };

  const updateViewMode = async (viewMode: AppSettings['viewMode']) => {
    try {
      await updateSettingsStore({ viewMode });
      setSettings((prev) => ({ ...prev, viewMode }));
    } catch (error) {
      console.error('Failed to update view mode:', error);
      throw error;
    }
  };

  return { settings, loading, updateTheme, updateViewMode };
}
