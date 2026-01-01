import { useEffect, type RefObject } from "react";
import { loader, type MonacoDiffEditor } from "@monaco-editor/react";

export const useMonacoRemeasure = (
  diffEditorRef: RefObject<MonacoDiffEditor | null>,
) => {
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
  }, [diffEditorRef]);
};
