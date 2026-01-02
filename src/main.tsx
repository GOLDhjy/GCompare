import React, { Suspense } from "react";
import ReactDOM from "react-dom/client";
import LandingPage from "./LandingPage";

// Check if running in Tauri environment
const isTauri = '__TAURI_INTERNALS__' in (window as any);

// Lazy load the App component only if we are in Tauri environment
// This prevents loading Tauri dependencies (and Monaco Editor) in the web browser
const App = isTauri ? React.lazy(() => import("./App")) : null;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isTauri && App ? (
      <Suspense fallback={<div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>Loading Editor...</div>}>
        <App />
      </Suspense>
    ) : (
      <LandingPage />
    )}
  </React.StrictMode>,
);
