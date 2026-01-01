import { useState } from "react";
import { DiffEditor } from "@monaco-editor/react";
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

  return (
    <main className="app">
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

      <section className="input-grid" aria-label="Diff inputs">
        <div className="input-panel">
          <label htmlFor="original-text">Original</label>
          <textarea
            id="original-text"
            value={originalText}
            onChange={(event) => setOriginalText(event.currentTarget.value)}
            spellCheck={false}
          />
        </div>
        <div className="input-panel">
          <label htmlFor="modified-text">Modified</label>
          <textarea
            id="modified-text"
            value={modifiedText}
            onChange={(event) => setModifiedText(event.currentTarget.value)}
            spellCheck={false}
          />
        </div>
      </section>

      <section className="diff-panel" aria-label="Diff preview">
        <DiffEditor
          original={originalText}
          modified={modifiedText}
          language="markdown"
          theme="vs"
          options={{
            renderSideBySide: sideBySide,
            readOnly: true,
            originalEditable: false,
            minimap: { enabled: false },
            renderOverviewRuler: false,
            lineNumbers: "on",
            fontFamily: "\"IBM Plex Mono\", \"SF Mono\", Consolas, monospace",
            fontSize: 13,
            wordWrap: "on",
          }}
        />
      </section>
    </main>
  );
}

export default App;
