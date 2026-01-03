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
import { useRecents } from "./hooks/useRecents";
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
  "Next: History compare",
  "",
  "- Fast navigation",
  "- Clean layout",
  "- Cross-platform",
].join("\n");
const initialModifiedText = [
  "Project: GCompare",
  "Focus: Text, file, and VCS diffs",
  "Next: History compare and packaging",
  "",
  "- Fast navigation",
  "- Clean layout",
  "- Cross-platform",
  "- Git/P4 CLI support",
].join("\n");
const gitVirtualPathPrefix = "git:";
const p4VirtualPathPrefix = "p4:";
const vcsVirtualPathPrefixes = [gitVirtualPathPrefix, p4VirtualPathPrefix];
type VcsProvider = "git" | "p4";
type HistoryProvider = VcsProvider | "none";
type HistoryEntry = {
  provider: VcsProvider;
  hash: string;
  timestamp: number;
  author: string;
  summary: string;
  path: string;
  deleted: boolean;
};
type HistoryResult = {
  provider: HistoryProvider;
  repoRoot: string | null;
  relativePath: string;
  entries: HistoryEntry[];
};
type EditorSide = "original" | "modified";
const isVirtualPath = (path: string | null) =>
  Boolean(path && vcsVirtualPathPrefixes.some((prefix) => path.startsWith(prefix)));
const getHistoryId = (entry: HistoryEntry) =>
  entry.provider === "git" ? entry.hash.slice(0, 7) : entry.hash;
const getHistoryPrefix = (provider: VcsProvider) =>
  provider === "git" ? gitVirtualPathPrefix : p4VirtualPathPrefix;
const formatCommitTime = (timestamp: number) =>
  new Date(timestamp * 1000).toLocaleString();
type LineChange = {
  originalStartLineNumber: number;
  originalEndLineNumber: number;
  modifiedStartLineNumber: number;
  modifiedEndLineNumber: number;
};
type PathParts = {
  name: string;
  parent: string;
  full: string;
};
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

const getPathParts = (path: string): PathParts => {
  const trimmed = path.replace(/[\\/]+$/, "");
  const slashIndex = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (slashIndex === -1) {
    return { name: trimmed, parent: "", full: path };
  }
  const name = trimmed.slice(slashIndex + 1) || trimmed;
  const parent = trimmed.slice(0, slashIndex);
  return { name, parent, full: path };
};

function App() {
  const { settings, updateTheme, updateViewMode } = useSettings();
  const systemTheme = useSystemTheme();
  const [updateBusy, setUpdateBusy] = useState(false);
  const diffEditorRef = useRef<MonacoDiffEditor | null>(null);
  const diffListenersRef = useRef<Array<{ dispose: () => void }>>([]);
  const focusedSideRef = useRef<EditorSide | null>(null);
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
    openFilePath,
    setSideContent,
  } = useFileHandlers({
    initialOriginalText,
    initialModifiedText,
    largeFileThreshold,
    showStatus,
  });
  const {
    recentFiles,
    recentProjects,
    addRecentFile,
    clearRecents,
  } = useRecents();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyPinned, setHistoryPinned] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyProvider, setHistoryProvider] = useState<HistoryProvider | null>(null);
  const [historyRepoRoot, setHistoryRepoRoot] = useState<string | null>(null);
  const [historyRelativePath, setHistoryRelativePath] = useState<string | null>(null);
  const [historySourceSide, setHistorySourceSide] = useState<"original" | "modified">(
    "original",
  );
  const [historySelectedHash, setHistorySelectedHash] = useState<string | null>(null);
  const [historyLoadingHash, setHistoryLoadingHash] = useState<string | null>(null);
  const lastHistoryPathRef = useRef<string | null>(null);
  const [recentsOpen, setRecentsOpen] = useState(false);
  const [recentsPinned, setRecentsPinned] = useState(false);
  const [diffChanges, setDiffChanges] = useState<LineChange[]>([]);
  const [diffIndex, setDiffIndex] = useState(0);

  const originalIsFile = Boolean(originalPath && !isVirtualPath(originalPath));
  const modifiedIsFile = Boolean(modifiedPath && !isVirtualPath(modifiedPath));
  const historyTargetPath =
    historySourceSide === "original"
      ? originalIsFile
        ? originalPath
        : null
      : modifiedIsFile
        ? modifiedPath
        : null;
  const historyVisible = historyPinned || historyOpen;
  const recentsVisible = recentsPinned || recentsOpen;
  const hasRecents = recentFiles.length > 0 || recentProjects.length > 0;

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
    if (historySourceSide === "original" && !originalIsFile && modifiedIsFile) {
      setHistorySourceSide("modified");
    } else if (historySourceSide === "modified" && !modifiedIsFile && originalIsFile) {
      setHistorySourceSide("original");
    }
  }, [historySourceSide, modifiedIsFile, originalIsFile]);

  useEffect(() => {
    if (originalPath && !isVirtualPath(originalPath)) {
      addRecentFile(originalPath);
    }
  }, [addRecentFile, originalPath]);

  useEffect(() => {
    if (modifiedPath && !isVirtualPath(modifiedPath)) {
      addRecentFile(modifiedPath);
    }
  }, [addRecentFile, modifiedPath]);

  useEffect(() => {
    return () => {
      diffEditorRef.current = null;
      focusedSideRef.current = null;
      diffListenersRef.current.forEach((listener) => listener.dispose());
      diffListenersRef.current = [];
    };
  }, []);

  const syncDiffChanges = useCallback(() => {
    const editor = diffEditorRef.current;
    if (!editor) {
      return;
    }
    const changes = editor.getLineChanges() ?? [];
    setDiffChanges(
      changes.map((change) => ({
        originalStartLineNumber: change.originalStartLineNumber,
        originalEndLineNumber: change.originalEndLineNumber,
        modifiedStartLineNumber: change.modifiedStartLineNumber,
        modifiedEndLineNumber: change.modifiedEndLineNumber,
      })),
    );
    setDiffIndex((prev) => {
      if (changes.length === 0) {
        return 0;
      }
      return Math.min(prev, changes.length - 1);
    });
  }, []);

  const handleDiffMount = (editor: MonacoDiffEditor) => {
    diffEditorRef.current = editor;
    diffListenersRef.current.forEach((listener) => listener.dispose());
    diffListenersRef.current = [];

    const originalEditor = editor.getOriginalEditor();
    const modifiedEditor = editor.getModifiedEditor();

    diffListenersRef.current.push(
      originalEditor.onDidFocusEditorText(() => {
        focusedSideRef.current = "original";
      }),
    );
    diffListenersRef.current.push(
      modifiedEditor.onDidFocusEditorText(() => {
        focusedSideRef.current = "modified";
      }),
    );

    syncDiffChanges();
    diffListenersRef.current.push(editor.onDidUpdateDiff(syncDiffChanges));
    diffListenersRef.current.push(editor.onDidChangeModel(syncDiffChanges));

    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const message = `[perf] DiffEditor mounted at ${Math.round(now - appStart)}ms`;
    console.info(message);
    void appendStartupLog(message);
  };

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      syncDiffChanges();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [modifiedText, originalText, sideBySide, syncDiffChanges]);

  const getPreferredSide = useCallback(() => {
    if (focusedSideRef.current) {
      return focusedSideRef.current;
    }
    if (!originalIsFile) {
      return "original";
    }
    if (!modifiedIsFile) {
      return "modified";
    }
    return "original";
  }, [modifiedIsFile, originalIsFile]);

  const handleOpenRecentFile = useCallback(
    (path: string) => {
      const side = getPreferredSide();
      void openFilePath(path, side);
    },
    [getPreferredSide, openFilePath],
  );

  const handleOpenRecentProject = useCallback(
    (path: string) => {
      const side = getPreferredSide();
      void handleOpenFile(side, path);
    },
    [getPreferredSide, handleOpenFile],
  );

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

  const handleSaveFocused = useCallback(async () => {
    const focusedSide = focusedSideRef.current;
    if (!focusedSide) {
      showStatus("Click inside a panel before saving.", 2500);
      return;
    }

    const path = focusedSide === "original" ? originalPath : modifiedPath;
    if (!path || isVirtualPath(path)) {
      showStatus("Open a file on this side before saving.", 2500);
      return;
    }

    const editor = diffEditorRef.current;
    if (!editor) {
      showStatus("Editor not ready.", 2000);
      return;
    }

    const targetEditor =
      focusedSide === "original"
        ? editor.getOriginalEditor()
        : editor.getModifiedEditor();
    const contents = targetEditor.getValue();

    try {
      await writeTextFile(path, contents);
      showStatus(
        `Saved ${focusedSide === "original" ? "left" : "right"} file.`,
        2000,
      );
    } catch (error) {
      console.error(error);
      showStatus("Failed to save file.", 2500);
    }
  }, [modifiedPath, originalPath, showStatus]);

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
      } else if (key === "s") {
        event.preventDefault();
        void handleSaveFocused();
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
  }, [handleOpenFile, handleSaveFocused, updateViewMode]);

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

      const shouldRestart = window.confirm(
        "Update installed. Restart the app now?",
      );
      if (shouldRestart) {
        await invoke("restart_app");
        return;
      }
      showStatus("Update installed. Please restart the app.", 5000);
    } catch (error) {
      console.error(error);
      showStatus("Update check failed.", 2500);
    } finally {
      setUpdateBusy(false);
    }
  }, [showStatus, updateBusy]);

  const formatInvokeError = useCallback((error: unknown) => {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }, []);

  const fetchHistory = useCallback(async (force = false) => {
    if (!historyTargetPath) {
      setHistoryEntries([]);
      setHistoryProvider(null);
      setHistoryRepoRoot(null);
      setHistoryRelativePath(null);
      setHistoryError("Open a file to view history.");
      lastHistoryPathRef.current = null;
      return;
    }

    if (
      !force
      && lastHistoryPathRef.current === historyTargetPath
      && historyEntries.length > 0
      && !historyError
    ) {
      return;
    }

    setHistoryBusy(true);
    setHistoryError(null);
    try {
      const result = await invoke<HistoryResult>("vcs_history", {
        path: historyTargetPath,
      });
      setHistoryEntries(result.entries);
      setHistoryRepoRoot(result.repoRoot);
      setHistoryRelativePath(result.relativePath);
      setHistoryProvider(result.provider);
      setHistorySelectedHash(null);
      lastHistoryPathRef.current = historyTargetPath;
    } catch (error) {
      const message = formatInvokeError(error);
      setHistoryEntries([]);
      setHistoryProvider(null);
      setHistoryRepoRoot(null);
      setHistoryRelativePath(null);
      setHistoryError(message);
      lastHistoryPathRef.current = null;
    } finally {
      setHistoryBusy(false);
    }
  }, [formatInvokeError, historyEntries.length, historyError, historyTargetPath]);

  const handleCompareCommit = useCallback(
    async (entry: HistoryEntry) => {
      if (entry.deleted) {
        showStatus("This change deleted the file.", 2500);
        return;
      }
      if (!historyTargetPath) {
        showStatus("History is not available yet.", 2500);
        return;
      }
      if (entry.provider === "git" && !historyRepoRoot) {
        showStatus("Git history is not available yet.", 2500);
        return;
      }

      setHistoryLoadingHash(entry.hash);
      setHistorySelectedHash(entry.hash);
      try {
        const content =
          entry.provider === "git"
            ? await invoke<string>("git_show_file", {
                repoRoot: historyRepoRoot,
                commit: entry.hash,
                path: entry.path,
              })
            : await invoke<string>("p4_show_file", {
                path: entry.path,
                change: entry.hash,
                workingPath: historyTargetPath,
              });
        const displayId = getHistoryId(entry);
        const commitLabel = `${getHistoryPrefix(entry.provider)}${displayId}:${entry.path}`;
        const workingText =
          historySourceSide === "original" ? originalText : modifiedText;
        const workingPath = historyTargetPath;
        const otherSide = historySourceSide === "original" ? "modified" : "original";
        const otherSidePath = otherSide === "original" ? originalPath : modifiedPath;
        const otherSideIsFile = otherSide === "original" ? originalIsFile : modifiedIsFile;
        const overwroteOtherSide =
          otherSideIsFile && otherSidePath && otherSidePath !== workingPath;

        if (historySourceSide === "original") {
          setSideContent("modified", workingText, workingPath);
          setSideContent("original", content, commitLabel);
          setHistorySourceSide("modified");
        } else {
          setSideContent("original", content, commitLabel);
        }

        showStatus(
          `Comparing with ${displayId}.${overwroteOtherSide ? " Replaced the other side." : ""}`,
          2600,
        );
      } catch (error) {
        console.error(error);
        showStatus("Failed to load history content.", 2500);
      } finally {
        setHistoryLoadingHash(null);
      }
    },
    [
      historyRepoRoot,
      historySourceSide,
      historyTargetPath,
      modifiedIsFile,
      modifiedPath,
      modifiedText,
      originalIsFile,
      originalPath,
      originalText,
      setSideContent,
      showStatus,
    ],
  );

  const handleNavigateDiff = useCallback(
    (direction: "next" | "prev") => {
      const editor = diffEditorRef.current;
      if (!editor) {
        return;
      }
      if (diffChanges.length === 0) {
        showStatus("No differences found.", 2000);
        return;
      }

      const nextIndex =
        direction === "next"
          ? Math.min(diffIndex + 1, diffChanges.length - 1)
          : Math.max(diffIndex - 1, 0);
      const change = diffChanges[nextIndex];
      const pickLine = (start: number, end: number) => {
        if (start > 0) {
          return start;
        }
        if (end > 0) {
          return end;
        }
        return 1;
      };
      const modifiedLine = pickLine(
        change.modifiedStartLineNumber,
        change.modifiedEndLineNumber,
      );
      const originalLine = pickLine(
        change.originalStartLineNumber,
        change.originalEndLineNumber,
      );
      const hasModified =
        change.modifiedStartLineNumber > 0 || change.modifiedEndLineNumber > 0;
      const hasOriginal =
        change.originalStartLineNumber > 0 || change.originalEndLineNumber > 0;
      const originalEditor = editor.getOriginalEditor();
      const modifiedEditor = editor.getModifiedEditor();
      const revealLine = (
        targetEditor: ReturnType<MonacoDiffEditor["getOriginalEditor"]>,
        line: number,
      ) => {
        targetEditor.revealLineInCenter(line);
        targetEditor.setPosition({ lineNumber: line, column: 1 });
      };

      if (!sideBySide) {
        const targetLine = hasModified ? modifiedLine : originalLine;
        revealLine(modifiedEditor, targetLine);
        modifiedEditor.focus();
        setDiffIndex(nextIndex);
        return;
      }

      if (hasOriginal) {
        revealLine(originalEditor, originalLine);
      }
      if (hasModified) {
        revealLine(modifiedEditor, modifiedLine);
      }
      const targetEditor = hasModified ? modifiedEditor : originalEditor;
      targetEditor.focus();
      setDiffIndex(nextIndex);
    },
    [diffChanges, diffIndex, showStatus, sideBySide],
  );

  useEffect(() => {
    if (!historyVisible) {
      return;
    }
    void fetchHistory();
  }, [fetchHistory, historyVisible]);

  useEffect(() => {
    let active = true;
    let unlistenDrag: (() => void) | null = null;
    let unlistenOpen: (() => void) | null = null;
    let unlistenMenu: (() => void) | null = null;
    let unlistenOpenLeft: (() => void) | null = null;
    let unlistenOpenRight: (() => void) | null = null;
    let unlistenSaveFocused: (() => void) | null = null;
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

      unlistenOpenLeft = await listen("gcompare://open-left", () => {
        if (!active) {
          return;
        }
        void handleOpenFile("original");
      });

      unlistenOpenRight = await listen("gcompare://open-right", () => {
        if (!active) {
          return;
        }
        void handleOpenFile("modified");
      });

      unlistenSaveFocused = await listen("gcompare://save-focused", () => {
        if (!active) {
          return;
        }
        void handleSaveFocused();
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
      if (unlistenOpenLeft) {
        unlistenOpenLeft();
      }
      if (unlistenOpenRight) {
        unlistenOpenRight();
      }
      if (unlistenSaveFocused) {
        unlistenSaveFocused();
      }
      if (unlistenTheme) {
        unlistenTheme();
      }
    };
  }, [
    applyPaths,
    enqueueOpenPaths,
    handleCheckUpdates,
    handleOpenFile,
    handleSaveFocused,
    updateTheme,
  ]);

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
          <div className="diff-nav diff-nav-bar">
            Diffs: {diffChanges.length === 0 ? "0" : `${diffIndex + 1}/${diffChanges.length}`}
            <button
              className="diff-nav-btn"
              type="button"
              onClick={() => handleNavigateDiff("prev")}
              disabled={diffChanges.length === 0}
              aria-label="Previous difference"
            >
              ↑
            </button>
            <button
              className="diff-nav-btn"
              type="button"
              onClick={() => handleNavigateDiff("next")}
              disabled={diffChanges.length === 0}
              aria-label="Next difference"
            >
              ↓
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
        <div className="workspace">
          <div
            className={`history-shell${historyVisible ? " is-open" : ""}${historyPinned ? " is-pinned" : ""}`}
            onMouseLeave={() => {
              if (!historyPinned) {
                setHistoryOpen(false);
              }
            }}
          >
            <div className="history-handles">
              <button
                className="history-handle"
                type="button"
                onMouseEnter={() => setHistoryOpen(true)}
                onClick={() => setHistoryPinned((prev) => !prev)}
                aria-pressed={historyPinned}
                title={historyPinned ? "Unpin history panel" : "Pin history panel"}
              >
                History
              </button>
            </div>
            <aside
              className="history-panel"
              aria-label="History"
              aria-hidden={!historyVisible}
            >
              {historyVisible ? (
                <div className="history-panel-inner">
                  <div className="history-panel-header">
                    <div className="history-panel-title">
                      <span className="history-title">History</span>
                      <span className="history-subtitle">
                        {historyRelativePath
                          ? `File: ${historyRelativePath}`
                          : historyProvider === "git"
                            ? "Git history"
                            : historyProvider === "p4"
                              ? "P4 history"
                              : "History"}
                      </span>
                    </div>
                    <div className="history-panel-actions">
                      <button
                        className="history-refresh"
                        type="button"
                        onClick={() => void fetchHistory(true)}
                        disabled={historyBusy}
                      >
                        {historyBusy ? "Loading..." : "Refresh"}
                      </button>
                    </div>
                  </div>
                  <div className="history-controls">
                    <label className="history-control">
                      <span>Source</span>
                      <select
                        value={historySourceSide}
                        onChange={(event) =>
                          setHistorySourceSide(
                            event.target.value as "original" | "modified",
                          )
                        }
                        disabled={!(originalIsFile && modifiedIsFile)}
                      >
                        <option value="original" disabled={!originalIsFile}>
                          Left file
                        </option>
                        <option value="modified" disabled={!modifiedIsFile}>
                          Right file
                        </option>
                      </select>
                    </label>
                  </div>
                  <div className="history-list">
                    {historyBusy ? (
                      <div className="history-empty">Loading history...</div>
                    ) : historyError ? (
                      <div className="history-empty">{historyError}</div>
                    ) : historyEntries.length === 0 ? (
                      <div className="history-empty">No history entries yet.</div>
                    ) : (
                      historyEntries.map((entry) => {
                        const displayId = getHistoryId(entry);
                        const idLabel =
                          entry.provider === "git" ? displayId : `CL ${displayId}`;
                        const isActive = historySelectedHash === entry.hash;
                        const isLoading = historyLoadingHash === entry.hash;
                        return (
                          <button
                            key={`${entry.provider}:${entry.hash}`}
                            type="button"
                            className={`history-item${isActive ? " is-active" : ""}`}
                            onClick={() => void handleCompareCommit(entry)}
                            disabled={entry.deleted || isLoading}
                          >
                            <span className="history-item-title">
                              {entry.summary || "(no message)"}
                            </span>
                            <span className="history-item-meta">
                              {idLabel} · {entry.author} · {formatCommitTime(entry.timestamp)}
                            </span>
                            {entry.deleted ? (
                              <span className="history-item-note">Deleted in this change</span>
                            ) : null}
                            {isLoading ? (
                              <span className="history-item-note">Loading content...</span>
                            ) : null}
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              ) : null}
            </aside>
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
          <div
            className={`recent-shell${recentsVisible ? " is-open" : ""}${recentsPinned ? " is-pinned" : ""}`}
            onMouseLeave={() => {
              if (!recentsPinned) {
                setRecentsOpen(false);
              }
            }}
          >
            <aside
              className="recent-panel"
              aria-label="Recent files and projects"
              aria-hidden={!recentsVisible}
            >
              {recentsVisible ? (
                <div className="recent-panel-inner">
                  <div className="recent-panel-header">
                    <div className="recent-panel-title">
                      <span className="recent-title">Recents</span>
                      <span className="recent-subtitle">Files & projects</span>
                    </div>
                    <div className="recent-panel-actions">
                      <button
                        className="recent-clear"
                        type="button"
                        onClick={() => clearRecents()}
                        disabled={!hasRecents}
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                  <div className="recent-section">
                    <div className="recent-section-header">
                      <span className="recent-section-title">Files</span>
                    </div>
                    <div className="recent-list">
                      {recentFiles.length === 0 ? (
                        <div className="recent-empty">No recent files.</div>
                      ) : (
                        recentFiles.map((path) => {
                          const parts = getPathParts(path);
                          const isActive =
                            path === originalPath || path === modifiedPath;
                          return (
                            <button
                              key={path}
                              type="button"
                              className={`recent-item${isActive ? " is-active" : ""}`}
                              onClick={() => handleOpenRecentFile(path)}
                              title={parts.full}
                            >
                              <span className="recent-item-title">{parts.name}</span>
                              <span className="recent-item-meta">
                                {parts.parent || parts.full}
                              </span>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                  <div className="recent-section">
                    <div className="recent-section-header">
                      <span className="recent-section-title">Projects</span>
                    </div>
                    <div className="recent-list">
                      {recentProjects.length === 0 ? (
                        <div className="recent-empty">No recent projects.</div>
                      ) : (
                        recentProjects.map((path) => {
                          const parts = getPathParts(path);
                          return (
                            <button
                              key={path}
                              type="button"
                              className="recent-item"
                              onClick={() => handleOpenRecentProject(path)}
                              title={parts.full}
                            >
                              <span className="recent-item-title">{parts.name}</span>
                              <span className="recent-item-meta">{parts.full}</span>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              ) : null}
            </aside>
            <div className="recent-handles">
              <button
                className="recent-handle"
                type="button"
                onMouseEnter={() => setRecentsOpen(true)}
                onClick={() => setRecentsPinned((prev) => !prev)}
                aria-pressed={recentsPinned}
                title={recentsPinned ? "Unpin recents panel" : "Pin recents panel"}
              >
                Recents
              </button>
            </div>
          </div>
        </div>
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
            Shortcuts: Ctrl/Cmd+O Left, Ctrl/Cmd+Shift+O Right, Ctrl/Cmd+S Save, Ctrl/Cmd+1/2 Mode
          </span>
        </div>
      </div>
    </main>
  );
}

export default App;
