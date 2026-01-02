import { useCallback, useEffect, useRef, useState } from "react";
import { DiffEditor, loader, type MonacoDiffEditor } from "@monaco-editor/react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { mkdir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { BaseDirectory } from "@tauri-apps/api/path";
import { check, type DownloadEvent } from "@tauri-apps/plugin-updater";
import { useFileHandlers } from "./hooks/useFileHandlers";
import { useMonacoRemeasure } from "./hooks/useMonacoRemeasure";
import { useStatusMessage } from "./hooks/useStatusMessage";
import { useSettings } from "./hooks/useSettings";
import { useSystemTheme } from "./hooks/useSystemTheme";
import { getMonacoTheme } from "./utils/monacoTheme";
import "./App.css";

const appStart = typeof performance !== "undefined" ? performance.now() : Date.now();
const logFilePath = "startup.log";
const editorFontSize = 13;
const editorFontFamily =
  "\"SF Mono\", Menlo, \"Cascadia Mono\", \"Consolas\", \"Courier New\", monospace";
const largeFileThreshold = 2 * 1024 * 1024;
const initialOriginalText = [
  "Project: GCompare",
  "Focus: Text and file diffs",
  "Next: Git history compare",
  "",
  "- Fast navigation",
  "- Clean layout",
  "- Cross-platform",
].join("\n");
const initialModifiedText = [
  "Project: GCompare",
  "Focus: Text, file, and Git diffs",
  "Next: History compare and packaging",
  "",
  "- Fast navigation",
  "- Clean layout",
  "- Cross-platform",
  "- Git CLI support",
].join("\n");
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
  const { settings, updateTheme, updateViewMode } = useSettings();
  const systemTheme = useSystemTheme();
  const [updateBusy, setUpdateBusy] = useState(false);
  const diffEditorRef = useRef<MonacoDiffEditor | null>(null);
  const updateProgressRef = useRef<{ total?: number; done: number }>({
    total: undefined,
    done: 0,
  });
  const { statusMessage, showStatus } = useStatusMessage();
  const {
    originalText,
    modifiedText,
    originalPath,
    modifiedPath,
    applyPaths,
    enqueueOpenPaths,
    handleOpenFile,
  } = useFileHandlers({
    initialOriginalText,
    initialModifiedText,
    largeFileThreshold,
    showStatus,
  });

  useMonacoRemeasure(diffEditorRef);

  // 计算实际主题
  const effectiveTheme = settings.theme === 'system'
    ? systemTheme
    : settings.theme;

  const sideBySide = settings.viewMode === 'side-by-side';

  // 应用主题到 DOM
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute(
        'data-theme',
        settings.theme === 'system' ? systemTheme : settings.theme
      );
    }
  }, [settings.theme, systemTheme]);

  useEffect(() => {
    return () => {
      diffEditorRef.current = null;
    };
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
        updateViewMode('side-by-side');
      } else if (key === "2") {
        event.preventDefault();
        updateViewMode('inline');
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
    let unlistenTheme: (() => void) | null = null;

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

      unlistenTheme = await listen<string>("gcompare://set-theme", (event) => {
        if (!active) {
          return;
        }
        const theme = event.payload;
        if (theme === 'system' || theme === 'light' || theme === 'dark') {
          void updateTheme(theme);
        }
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
      if (unlistenTheme) {
        unlistenTheme();
      }
    };
  }, [applyPaths, enqueueOpenPaths, handleCheckUpdates, updateTheme]);

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
              onClick={() => {
                const newMode = sideBySide ? 'inline' : 'side-by-side';
                updateViewMode(newMode);
              }}
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
            theme={getMonacoTheme(effectiveTheme)}
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
