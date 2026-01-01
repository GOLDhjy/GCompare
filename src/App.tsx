import { useEffect, useRef, useState } from "react";
import { DiffEditor, type MonacoDiffEditor } from "@monaco-editor/react";
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
  const diffEditorRef = useRef<MonacoDiffEditor | null>(null);
  const disposablesRef = useRef<Array<{ dispose: () => void }>>([]);

  useEffect(() => {
    return () => {
      disposablesRef.current.forEach((disposable) => disposable.dispose());
      disposablesRef.current = [];
      diffEditorRef.current = null;
    };
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

        <section className="diff-panel" aria-label="Diff editor">
          <DiffEditor
            original={originalText}
            modified={modifiedText}
            language="markdown"
            theme="vs"
            onMount={handleDiffMount}
            options={{
              renderSideBySide: sideBySide,
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
