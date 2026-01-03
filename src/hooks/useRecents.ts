import { useCallback, useEffect, useState } from "react";
import type { RecentData } from "../types/recents";
import {
  DEFAULT_RECENTS,
  MAX_RECENT_FILES,
  MAX_RECENT_PROJECTS,
} from "../types/recents";
import { getRecents, saveRecents } from "../services/recentStore";

const addToRecents = (list: string[], value: string, limit: number) => {
  const next = [value, ...list.filter((item) => item !== value)];
  return next.slice(0, limit);
};

const mergeRecents = (primary: string[], secondary: string[], limit: number) => {
  const combined = primary.slice();
  secondary.forEach((item) => {
    if (!combined.includes(item)) {
      combined.push(item);
    }
  });
  return combined.slice(0, limit);
};

const getDirectoryPath = (path: string) => {
  const trimmed = path.replace(/[\\/]+$/, "");
  const slashIndex = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (slashIndex === -1) {
    return null;
  }
  if (slashIndex === 0) {
    return "/";
  }
  if (slashIndex === 2 && trimmed[1] === ":") {
    return trimmed.slice(0, slashIndex + 1);
  }
  return trimmed.slice(0, slashIndex);
};

export function useRecents() {
  const [recents, setRecents] = useState<RecentData>(DEFAULT_RECENTS);

  const persist = useCallback(async (next: RecentData) => {
    try {
      await saveRecents(next);
    } catch (error) {
      console.error("Failed to save recents:", error);
    }
  }, []);

  useEffect(() => {
    getRecents()
      .then((data) => {
        setRecents((prev) => {
          if (prev.files.length === 0 && prev.projects.length === 0) {
            return data;
          }
          const merged = {
            files: mergeRecents(prev.files, data.files, MAX_RECENT_FILES),
            projects: mergeRecents(
              prev.projects,
              data.projects,
              MAX_RECENT_PROJECTS,
            ),
          };
          void persist(merged);
          return merged;
        });
      })
      .catch((error) => {
        console.error("Failed to load recents:", error);
      });
  }, [persist]);

  const addRecentFile = useCallback(
    (path: string) => {
      if (!path) {
        return;
      }
      setRecents((prev) => {
        const nextFiles = addToRecents(prev.files, path, MAX_RECENT_FILES);
        const projectPath = getDirectoryPath(path);
        const nextProjects = projectPath
          ? addToRecents(prev.projects, projectPath, MAX_RECENT_PROJECTS)
          : prev.projects;
        const next = { files: nextFiles, projects: nextProjects };
        void persist(next);
        return next;
      });
    },
    [persist],
  );

  const clearRecents = useCallback(() => {
    setRecents(DEFAULT_RECENTS);
    void persist(DEFAULT_RECENTS);
  }, [persist]);

  const clearRecentFiles = useCallback(() => {
    setRecents((prev) => {
      const next = { ...prev, files: [] };
      void persist(next);
      return next;
    });
  }, [persist]);

  const clearRecentProjects = useCallback(() => {
    setRecents((prev) => {
      const next = { ...prev, projects: [] };
      void persist(next);
      return next;
    });
  }, [persist]);

  return {
    recentFiles: recents.files,
    recentProjects: recents.projects,
    addRecentFile,
    clearRecents,
    clearRecentFiles,
    clearRecentProjects,
  };
}
