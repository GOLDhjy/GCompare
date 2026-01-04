import { useCallback, useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";

type Side = "original" | "modified";

type UseFileHandlersOptions = {
  initialOriginalText: string;
  initialModifiedText: string;
  largeFileThreshold: number;
  showStatus: (message: string, timeout?: number) => void;
};

export const useFileHandlers = ({
  initialOriginalText,
  initialModifiedText,
  largeFileThreshold,
  showStatus,
}: UseFileHandlersOptions) => {
  const [originalText, setOriginalText] = useState(initialOriginalText);
  const [modifiedText, setModifiedText] = useState(initialModifiedText);
  const [originalPath, setOriginalPath] = useState<string | null>(null);
  const [modifiedPath, setModifiedPath] = useState<string | null>(null);
  const openSlotRef = useRef<Side>("original");
  const pathStateRef = useRef({ original: false, modified: false });
  const openQueueRef = useRef<string[]>([]);
  const openQueueTimerRef = useRef<number | null>(null);
  const applyPathsRef = useRef<((paths: string[], source: "drop" | "open", preferredSide?: Side) => Promise<void>) | null>(null);

  useEffect(() => {
    return () => {
      if (openQueueTimerRef.current) {
        window.clearTimeout(openQueueTimerRef.current);
        openQueueTimerRef.current = null;
      }
      openQueueRef.current = [];
    };
  }, []);

  const formatBytes = useCallback((bytes: number) => {
    if (bytes >= 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    if (bytes >= 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${bytes} B`;
  }, []);

  const showLoadedStatus = useCallback(
    (size: number) => {
      if (size >= largeFileThreshold) {
        showStatus(
          `File loaded. Large: ${formatBytes(size)}.`,
          2600,
        );
      } else {
        showStatus("File loaded.");
      }
    },
    [formatBytes, largeFileThreshold, showStatus],
  );

  const loadFileToSide = useCallback(async (path: string, side: Side) => {
    try {
      const bytes = await readFile(path);
      const decoder = new TextDecoder("utf-8", { fatal: false });
      const contents = decoder.decode(bytes).replace(/\r\n?/g, "\n");
      if (side === "original") {
        setOriginalPath(path);
        setOriginalText(contents);
      } else {
        setModifiedPath(path);
        setModifiedText(contents);
      }
      return { ok: true, size: bytes.length };
    } catch (error) {
      console.error(`Failed to load file: ${path}`, error);
      return { ok: false, size: 0 };
    }
  }, []);

  const resolveOpenSide = useCallback(() => {
    const state = pathStateRef.current;
    if (!state.original && state.modified) {
      return "original";
    }
    if (state.original && !state.modified) {
      return "modified";
    }
    const next = openSlotRef.current;
    openSlotRef.current = next === "original" ? "modified" : "original";
    return next;
  }, []);

  const reserveSide = useCallback((side: Side) => {
    const state = pathStateRef.current;
    const wasEmpty = !state[side];
    state[side] = true;
    return wasEmpty;
  }, []);

  const applyPaths = useCallback(
    async (
      paths: string[],
      source: "drop" | "open",
      preferredSide?: Side,
    ) => {
      const filtered = paths.filter(Boolean).slice(0, 2);
      if (filtered.length === 0) {
        return;
      }

      let loaded = 0;
      const largeSides: Array<"Left" | "Right"> = [];
      if (filtered.length === 1) {
        const side = preferredSide ?? resolveOpenSide();
        const sideWasEmpty = reserveSide(side);
        const result = await loadFileToSide(filtered[0], side);
        if (result.ok) {
          loaded = 1;
          if (result.size >= largeFileThreshold) {
            largeSides.push(side === "original" ? "Left" : "Right");
          }
        } else if (sideWasEmpty) {
          pathStateRef.current[side] = false;
        }
      } else {
        const [first, second] = filtered;
        const firstSide = preferredSide ?? "original";
        const secondSide = firstSide === "original" ? "modified" : "original";
        const firstWasEmpty = reserveSide(firstSide);
        const secondWasEmpty = reserveSide(secondSide);
        const results = await Promise.all([
          loadFileToSide(first, firstSide),
          loadFileToSide(second, secondSide),
        ]);
        loaded = results.filter((result) => result.ok).length;
        results.forEach((result, index) => {
          if (result.ok && result.size >= largeFileThreshold) {
            const side = index === 0 ? firstSide : secondSide;
            largeSides.push(side === "original" ? "Left" : "Right");
          }
        });
        if (!results[0].ok && firstWasEmpty) {
          pathStateRef.current[firstSide] = false;
        }
        if (!results[1].ok && secondWasEmpty) {
          pathStateRef.current[secondSide] = false;
        }
      }

      if (loaded > 0) {
        const label = source === "drop" ? "Dropped" : "Loaded";
        const largeNote =
          largeSides.length > 0
            ? ` Large: ${largeSides.join(", ")}.`
            : "";
        showStatus(
          `${label} ${loaded} file${loaded > 1 ? "s" : ""}.${largeNote}`,
          2600,
        );
      } else {
        showStatus("Failed to load files.", 2500);
      }
    },
    [largeFileThreshold, loadFileToSide, reserveSide, resolveOpenSide, showStatus],
  );

  // Keep a ref to the latest applyPaths to avoid stale closure in setTimeout
  useEffect(() => {
    applyPathsRef.current = applyPaths;
  }, [applyPaths]);

  const flushOpenQueue = useCallback(() => {
    const pending = openQueueRef.current;
    openQueueRef.current = [];
    if (openQueueTimerRef.current) {
      window.clearTimeout(openQueueTimerRef.current);
      openQueueTimerRef.current = null;
    }
    if (pending.length > 0 && applyPathsRef.current) {
      void applyPathsRef.current(pending, "open");
    }
  }, []);

  const enqueueOpenPaths = useCallback(
    (paths: string[]) => {
      const next = paths.filter(Boolean);
      if (next.length === 0) {
        return;
      }
      if (openQueueRef.current.length === 0 && openQueueTimerRef.current === null) {
        openSlotRef.current = "original";
      }
      openQueueRef.current = openQueueRef.current.concat(next);
      if (openQueueTimerRef.current === null) {
        openQueueTimerRef.current = window.setTimeout(flushOpenQueue, 250);
      }
    },
    [flushOpenQueue],
  );

  const openFilePath = useCallback(
    async (path: string, preferredSide?: Side) => {
      if (!path) {
        return;
      }
      const side = preferredSide ?? resolveOpenSide();
      const sideWasEmpty = reserveSide(side);
      try {
        const result = await loadFileToSide(path, side);
        if (result.ok) {
          showLoadedStatus(result.size);
        } else {
          if (sideWasEmpty) {
            pathStateRef.current[side] = false;
          }
          showStatus("Failed to load file.", 2500);
        }
      } catch (error) {
        console.error(error);
        if (sideWasEmpty) {
          pathStateRef.current[side] = false;
        }
        showStatus("Failed to load file.", 2500);
      }
    },
    [loadFileToSide, reserveSide, resolveOpenSide, showLoadedStatus, showStatus],
  );

  const handleOpenFile = useCallback(
    async (side: Side, defaultPath?: string) => {
      const sideWasEmpty = reserveSide(side);
      try {
        const selection = await open({
          multiple: false,
          directory: false,
          defaultPath,
        });

        if (!selection || Array.isArray(selection)) {
          if (sideWasEmpty) {
            pathStateRef.current[side] = false;
          }
          return;
        }

        const result = await loadFileToSide(selection, side);
        if (result.ok) {
          showLoadedStatus(result.size);
        } else {
          if (sideWasEmpty) {
            pathStateRef.current[side] = false;
          }
          showStatus("Failed to load file.", 2500);
        }
      } catch (error) {
        console.error(error);
        if (sideWasEmpty) {
          pathStateRef.current[side] = false;
        }
        showStatus("Failed to load file.", 2500);
      }
    },
    [loadFileToSide, reserveSide, showLoadedStatus, showStatus],
  );

  const setSideContent = useCallback((side: Side, contents: string, path: string | null) => {
    if (side === "original") {
      setOriginalText(contents);
      setOriginalPath(path);
    } else {
      setModifiedText(contents);
      setModifiedPath(path);
    }
    pathStateRef.current[side] = Boolean(path);
  }, []);

  return {
    originalText,
    modifiedText,
    originalPath,
    modifiedPath,
    applyPaths,
    enqueueOpenPaths,
    handleOpenFile,
    openFilePath,
    setSideContent,
  };
};
