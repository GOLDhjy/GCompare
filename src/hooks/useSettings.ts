import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { AppSettings, P4Settings, SVNSettings } from '../types/settings';
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
        // 同步 P4 设置到后端
        if (loadedSettings.p4) {
          try {
            await invoke('update_p4_settings', {
              port: loadedSettings.p4.port || '',
              user: loadedSettings.p4.user || '',
              client: loadedSettings.p4.client || '',
            });
          } catch (error) {
            console.error('Failed to sync P4 settings:', error);
          }
        }

        // 同步 SVN 设置到后端
        if (loadedSettings.svn) {
          try {
            await invoke('update_svn_settings', {
              path: loadedSettings.svn.path || '',
            });
          } catch (error) {
            console.error('Failed to sync SVN settings:', error);
          }
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

  const updateP4Settings = async (p4: P4Settings) => {
    try {
      await updateSettingsStore({ p4 });
      setSettings((prev) => ({ ...prev, p4 }));
      // 同步到后端
      await invoke('update_p4_settings', {
        port: p4.port || '',
        user: p4.user || '',
        client: p4.client || '',
      });
    } catch (error) {
      console.error('Failed to update P4 settings:', error);
      throw error;
    }
  };

  const updateSVNSettings = async (svn: SVNSettings) => {
    try {
      await updateSettingsStore({ svn });
      setSettings((prev) => ({ ...prev, svn }));
      // 同步到后端
      await invoke('update_svn_settings', {
        path: svn.path || '',
      });
    } catch (error) {
      console.error('Failed to update SVN settings:', error);
      throw error;
    }
  };

  return { settings, loading, updateTheme, updateViewMode, updateP4Settings, updateSVNSettings };
}
