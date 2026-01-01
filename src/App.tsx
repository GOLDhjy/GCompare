import { useCallback, useEffect, useRef, useState } from "react";
import { DiffEditor, type MonacoDiffEditor } from "@monaco-editor/react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import "./App.css";

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
  const diffEditorRef = useRef<MonacoDiffEditor | null>(null);
  const disposablesRef = useRef<Array<{ dispose: () => void }>>([]);
  const statusTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      disposablesRef.current.forEach((disposable) => disposable.dispose());
      disposablesRef.current = [];
      diffEditorRef.current = null;
      if (statusTimerRef.current) {
        window.clearTimeout(statusTimerRef.current);
        statusTimerRef.current = null;
      }
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

  const handleDiffMount = (editor: MonacoDiffEditor) => {
    diffEditorRef.current = editor;
    disposablesRef.current.forEach((disposable) => disposable.dispose());
    disposablesRef.current = [];

    const model = editor.getModel();
    if (!model) {
      return;
    }

    const originalModel = model.original;
    const modifiedModel = model.modified;

    const originalDisposable = originalModel.onDidChangeContent(() => {
      const value = originalModel.getValue();
      setOriginalText((prev) => (prev === value ? prev : value));
    });
    const modifiedDisposable = modifiedModel.onDidChangeContent(() => {
      const value = modifiedModel.getValue();
      setModifiedText((prev) => (prev === value ? prev : value));
    });

    disposablesRef.current.push(originalDisposable, modifiedDisposable);
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
        const contents = await readTextFile(path);
        if (side === "original") {
          setOriginalPath(path);
          setOriginalText(contents);
        } else {
          setModifiedPath(path);
          setModifiedText(contents);
        }
        return true;
      } catch (error) {
        console.error(error);
        return false;
      }
    },
    [],
  );

  const applyPaths = useCallback(
    async (
      paths: string[],
      source: "drop" | "open",
      preferredSide?: "original" | "modified",
    ) => {
      const filtered = paths.filter(Boolean).slice(0, 2);
      if (filtered.length === 0) {
        return;
      }

      let loaded = 0;
      if (filtered.length === 1) {
        const side = preferredSide ?? "original";
        if (await loadFileToSide(filtered[0], side)) {
          loaded = 1;
        }
      } else {
        const [first, second] = filtered;
        const firstSide = preferredSide ?? "original";
        const secondSide = firstSide === "original" ? "modified" : "original";
        const results = await Promise.all([
          loadFileToSide(first, firstSide),
          loadFileToSide(second, secondSide),
        ]);
        loaded = results.filter(Boolean).length;
      }

      if (loaded > 0) {
        const label = source === "drop" ? "Dropped" : "Loaded";
        showStatus(`${label} ${loaded} file${loaded > 1 ? "s" : ""}.`);
      } else {
        showStatus("Failed to load files.", 2500);
      }
    },
    [loadFileToSide, showStatus],
  );

  const handleOpenFile = async (side: "original" | "modified") => {
    try {
      const selection = await open({
        multiple: false,
        directory: false,
      });

      if (!selection || Array.isArray(selection)) {
        return;
      }

      const contents = await readTextFile(selection);
      if (side === "original") {
        setOriginalPath(selection);
        setOriginalText(contents);
      } else {
        setModifiedPath(selection);
        setModifiedText(contents);
      }

      showStatus("File loaded.");
    } catch (error) {
      console.error(error);
      showStatus("Failed to load file.", 2500);
    }
  };

  useEffect(() => {
    let active = true;
    let unlistenDrag: (() => void) | null = null;
    let unlistenOpen: (() => void) | null = null;

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
            void applyPaths(event.payload, "open");
          }
        },
      );

      const initial = await invoke<string[]>("consume_open_paths");
      if (active && Array.isArray(initial) && initial.length > 0) {
        void applyPaths(initial, "open");
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
    };
  }, [applyPaths]);

  return (
    <main className="app">
      <div className="app-shell">
        <header className="app-header">
          <div className="brand">
            <div className="brand-mark" aria-hidden="true">
              GC
            </div>
            <div className="brand-text">
              <p className="brand-kicker">Diff Studio</p>
              <h1>GCompare</h1>
              <p className="brand-subtitle">
                Text, file, and Git history diffs with a clean workflow.
              </p>
            </div>
          </div>
          <div className="controls">
            <div className="actions">
              <button
                className="action-btn"
                type="button"
                onClick={() => handleOpenFile("original")}
              >
                Open Left File
              </button>
              <button
                className="action-btn"
                type="button"
                onClick={() => handleOpenFile("modified")}
              >
                Open Right File
              </button>
            </div>
            <div className="toggle">
              <span className="toggle-label">View</span>
              <button
                className={sideBySide ? "toggle-btn active" : "toggle-btn"}
                onClick={() => setSideBySide(true)}
                type="button"
              >
                Side-by-side
              </button>
              <button
                className={!sideBySide ? "toggle-btn active" : "toggle-btn"}
                onClick={() => setSideBySide(false)}
                type="button"
              >
                Inline
              </button>
            </div>
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
              fontFamily: "\"IBM Plex Mono\", \"SF Mono\", Consolas, monospace",
              fontSize: 13,
              wordWrap: "on",
            }}
          />
        </section>
      </div>
    </main>
  );
}

export default App;
