import { useCallback, useEffect, useRef, useState } from "react";
import { DiffEditor, loader, type MonacoDiffEditor } from "@monaco-editor/react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { mkdir, readFile, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { BaseDirectory } from "@tauri-apps/api/path";
import { check, type DownloadEvent } from "@tauri-apps/plugin-updater";
import "./App.css";

const appStart = typeof performance !== "undefined" ? performance.now() : Date.now();
const logFilePath = "startup.log";
const editorFontSize = 13;
const editorFontFamily =
  "\"SF Mono\", Menlo, \"Cascadia Mono\", \"Consolas\", \"Courier New\", monospace";
const appendStartupLog = async (message: string) => {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}`;

  try {
    await mkdir("", { recursive: true, baseDir: BaseDirectory.AppLog });
  } catch {
    // Best-effort; continue even if the folder already exists or cannot be created.
  }

  let existing = "";
  try {
    existing = await readTextFile(logFilePath, { baseDir: BaseDirectory.AppLog });
  } catch {
    existing = "";
  }

  const next = existing ? `${existing}\n${line}` : line;
  try {
    await writeTextFile(logFilePath, next, { baseDir: BaseDirectory.AppLog });
  } catch (error) {
    console.warn("Failed to write startup log.", error);
  }
};

if (import.meta.env.PROD && typeof window !== "undefined") {
  const monacoBaseUrl = new URL("./monaco/vs", window.location.href).toString();
  loader.config({ paths: { vs: monacoBaseUrl } });
}

function App() {
  const [originalText, setOriginalText] = useState(
    [
      "Project: GCompare",
      "Focus: Text and file diffs",
      "Next: Git history compare",
      "",
      "- Fast navigation",
      "- Clean layout",
      "- Cross-platform",
    ].join("\n"),
  );
  const [modifiedText, setModifiedText] = useState(
    [
      "Project: GCompare",
      "Focus: Text, file, and Git diffs",
      "Next: History compare and packaging",
      "",
      "- Fast navigation",
      "- Clean layout",
      "- Cross-platform",
      "- Git CLI support",
    ].join("\n"),
  );
  const [sideBySide, setSideBySide] = useState(true);
  const [originalPath, setOriginalPath] = useState<string | null>(null);
  const [modifiedPath, setModifiedPath] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const diffEditorRef = useRef<MonacoDiffEditor | null>(null);
  const statusTimerRef = useRef<number | null>(null);
  const openSlotRef = useRef<"original" | "modified">("original");
  const pathStateRef = useRef({ original: false, modified: false });
  const openQueueRef = useRef<string[]>([]);
  const openQueueTimerRef = useRef<number | null>(null);
  const largeFileThreshold = 2 * 1024 * 1024;
  const updateProgressRef = useRef<{ total?: number; done: number }>({
    total: undefined,
    done: 0,
  });

  useEffect(() => {
    return () => {
      diffEditorRef.current = null;
      if (statusTimerRef.current) {
        window.clearTimeout(statusTimerRef.current);
        statusTimerRef.current = null;
      }
      if (openQueueTimerRef.current) {
        window.clearTimeout(openQueueTimerRef.current);
        openQueueTimerRef.current = null;
      }
      openQueueRef.current = [];
    };
  }, []);

  const showStatus = useCallback((message: string, timeout = 2000) => {
    setStatusMessage(message);
    if (statusTimerRef.current) {
      window.clearTimeout(statusTimerRef.current);
    }
    statusTimerRef.current = window.setTimeout(() => {
      setStatusMessage(null);
      statusTimerRef.current = null;
    }, timeout);
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

  const handleDiffMount = (editor: MonacoDiffEditor) => {
    diffEditorRef.current = editor;

    const model = editor.getModel();
    if (!model) {
      return;
    }

    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const message = `[perf] DiffEditor mounted at ${Math.round(now - appStart)}ms`;
    console.info(message);
    void appendStartupLog(message);
  };

  const getDropSide = (rawX: number) => {
    const scale = window.devicePixelRatio || 1;
    const logicalX = rawX;
    const physicalX = rawX / scale;
    const container = diffEditorRef.current?.getContainerDomNode();
    if (container) {
      const rect = container.getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      const logicalInRect = logicalX >= rect.left && logicalX <= rect.right;
      const physicalInRect = physicalX >= rect.left && physicalX <= rect.right;

      const xToUse = logicalInRect && !physicalInRect
        ? logicalX
        : physicalInRect && !logicalInRect
          ? physicalX
          : logicalX;

      return xToUse < midX ? "original" : "modified";
    }
    return logicalX < window.innerWidth / 2 ? "original" : "modified";
  };

  const loadFileToSide = useCallback(
    async (path: string, side: "original" | "modified") => {
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
        console.error(error);
        return { ok: false, size: 0 };
      }
    },
    [],
  );

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

  const reserveSide = useCallback((side: "original" | "modified") => {
    const state = pathStateRef.current;
    const wasEmpty = !state[side];
    state[side] = true;
    return wasEmpty;
  }, []);

  const applyPaths = useCallback(
    async (
      paths: string[],
      source: "drop" | "open",
      preferredSide?: "original" | "modified",
    ) => {
      const normalizedPaths = paths;
      const filtered = normalizedPaths.filter(Boolean).slice(0, 2);
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

  const flushOpenQueue = useCallback(() => {
    const pending = openQueueRef.current;
    openQueueRef.current = [];
    if (openQueueTimerRef.current) {
      window.clearTimeout(openQueueTimerRef.current);
      openQueueTimerRef.current = null;
    }
    if (pending.length > 0) {
      void applyPaths(pending, "open");
    }
  }, [applyPaths]);

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

  const handleOpenFile = useCallback(
    async (side: "original" | "modified") => {
      const sideWasEmpty = reserveSide(side);
      try {
        const selection = await open({
          multiple: false,
          directory: false,
        });

        if (!selection || Array.isArray(selection)) {
          if (sideWasEmpty) {
            pathStateRef.current[side] = false;
          }
          return;
        }

        const result = await loadFileToSide(selection, side);
        if (result.ok) {
          if (result.size >= largeFileThreshold) {
            showStatus(
              `File loaded. Large: ${formatBytes(result.size)}.`,
              2600,
            );
          } else {
            showStatus("File loaded.");
          }
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
    [formatBytes, largeFileThreshold, loadFileToSide, reserveSide, showStatus],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isMod = event.metaKey || event.ctrlKey;
      if (!isMod) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "o") {
        event.preventDefault();
        if (event.shiftKey) {
          void handleOpenFile("modified");
        } else {
          void handleOpenFile("original");
        }
      } else if (key === "1") {
        event.preventDefault();
        setSideBySide(true);
      } else if (key === "2") {
        event.preventDefault();
        setSideBySide(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleOpenFile]);

  useEffect(() => {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const message = `[perf] App mounted at ${Math.round(now - appStart)}ms`;
    console.info(message);
    void appendStartupLog(message);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let pending = false;
    const remeasure = async () => {
      if (pending) {
        return;
      }
      pending = true;
      try {
        if (typeof document !== "undefined" && "fonts" in document) {
          await document.fonts.ready;
        }
        if (cancelled) {
          return;
        }
        const monaco = await loader.init();
        if (cancelled) {
          return;
        }
        monaco.editor.remeasureFonts();
        diffEditorRef.current?.layout();
      } catch (error) {
        console.warn("Failed to remeasure Monaco fonts.", error);
      } finally {
        pending = false;
      }
    };

    void remeasure();
    if (typeof window !== "undefined") {
      const handleResize = () => {
        void remeasure();
      };
      const handleVisibility = () => {
        if (document.visibilityState === "visible") {
          void remeasure();
        }
      };
      window.addEventListener("resize", handleResize);
      document.addEventListener("visibilitychange", handleVisibility);
      return () => {
        cancelled = true;
        window.removeEventListener("resize", handleResize);
        document.removeEventListener("visibilitychange", handleVisibility);
      };
    }
    return () => {
      cancelled = true;
    };
  }, []);

  const handleCheckUpdates = useCallback(async () => {
    if (updateBusy) {
      return;
    }

    setUpdateBusy(true);
    updateProgressRef.current = { total: undefined, done: 0 };
    showStatus("Checking for updates...");

    try {
      const update = await check();
      if (!update) {
        showStatus("You're on the latest version.");
        return;
      }

      const confirmUpdate = window.confirm(
        `Update ${update.version} is available. Download and install now?`,
      );
      if (!confirmUpdate) {
        showStatus("Update canceled.");
        return;
      }

      showStatus(`Downloading ${update.version}...`);
      await update.downloadAndInstall((event: DownloadEvent) => {
        if (event.event === "Started") {
          updateProgressRef.current.total = event.data.contentLength;
          updateProgressRef.current.done = 0;
        } else if (event.event === "Progress") {
          updateProgressRef.current.done += event.data.chunkLength;
        }

        const total = updateProgressRef.current.total;
        if (total && total > 0) {
          const pct = Math.min(
            100,
            Math.round((updateProgressRef.current.done / total) * 100),
          );
          showStatus(`Downloading update... ${pct}%`, 1200);
        } else if (event.event === "Finished") {
          showStatus("Download finished. Installing...", 1500);
        }
      });

      showStatus("Update installed. Please restart the app.", 5000);
    } catch (error) {
      console.error(error);
      showStatus("Update check failed.", 2500);
    } finally {
      setUpdateBusy(false);
    }
  }, [showStatus, updateBusy]);

  useEffect(() => {
    let active = true;
    let unlistenDrag: (() => void) | null = null;
    let unlistenOpen: (() => void) | null = null;
    let unlistenMenu: (() => void) | null = null;

    const setup = async () => {
      unlistenDrag = await getCurrentWindow().onDragDropEvent((event) => {
        if (!active) {
          return;
        }
        if (event.payload.type === "drop") {
          const preferredSide = getDropSide(event.payload.position.x);
          void applyPaths(event.payload.paths, "drop", preferredSide);
        }
      });

      unlistenOpen = await listen<string[]>(
        "gcompare://open-files",
        (event) => {
          if (!active) {
            return;
          }
          if (Array.isArray(event.payload)) {
            enqueueOpenPaths(event.payload);
          }
        },
      );

      unlistenMenu = await listen("gcompare://check-updates", () => {
        if (!active) {
          return;
        }
        void handleCheckUpdates();
      });

      const initial = await invoke<string[]>("consume_open_paths");
      if (active && Array.isArray(initial) && initial.length > 0) {
        enqueueOpenPaths(initial);
      }
    };

    setup().catch((error) => console.error(error));

    return () => {
      active = false;
      if (unlistenDrag) {
        unlistenDrag();
      }
      if (unlistenOpen) {
        unlistenOpen();
      }
      if (unlistenMenu) {
        unlistenMenu();
      }
    };
  }, [applyPaths, enqueueOpenPaths, handleCheckUpdates]);

  return (
    <main className="app">
      <div className="app-shell">
        <header className="app-header">
          <div className="actions">
            <button
              className="action-btn"
              type="button"
              onClick={() => handleOpenFile("original")}
            >
              <span className="action-label-full">Open Left File</span>
              <span className="action-label-short">Left File</span>
            </button>
            <button
              className="action-btn"
              type="button"
              onClick={() => handleOpenFile("modified")}
            >
              <span className="action-label-full">Open Right File</span>
              <span className="action-label-short">Right File</span>
            </button>
          </div>
          <div className="toggle">
            <button
              className="toggle-switch"
              onClick={() => setSideBySide((prev) => !prev)}
              type="button"
              aria-pressed={!sideBySide}
            >
              <span className="toggle-text">
                Inline
              </span>
              <span className="toggle-state">{sideBySide ? "Off" : "On"}</span>
              <span className="toggle-track" aria-hidden="true">
                <span className="toggle-knob" />
              </span>
            </button>
          </div>
        </header>
        <div className="status-bar" role="status" aria-live="polite">
          <span className="status-item">
            Left: {originalPath ? originalPath : "Untitled"}
          </span>
          <span className="status-item">
            Right: {modifiedPath ? modifiedPath : "Untitled"}
          </span>
          <span className="status-item status-message">
            {statusMessage ?? ""}
          </span>
          <span className="status-item hint">
            Shortcuts: Ctrl/Cmd+O Left, Ctrl/Cmd+Shift+O Right, Ctrl/Cmd+1/2 Mode
          </span>
        </div>

        <section className="diff-panel" aria-label="Diff editor">
          <DiffEditor
            original={originalText}
            modified={modifiedText}
            language="markdown"
            theme="vs"
            onMount={handleDiffMount}
            options={{
              renderSideBySide: sideBySide,
              useInlineViewWhenSpaceIsLimited: false,
              readOnly: false,
              originalEditable: true,
              minimap: { enabled: false },
              renderOverviewRuler: false,
              lineNumbers: "on",
              fontFamily: editorFontFamily,
              fontSize: editorFontSize,
              wordWrap: "on",
            }}
          />
        </section>
      </div>
    </main>
  );
}

export default App;
