import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./globals.css";
import { App } from "./App";

/**
 * Tauri v2 injects `__TAURI_INTERNALS__` into the webview at startup.
 * Regular browsers don't have it, so any @tauri-apps/* API call would
 * crash with "Cannot read properties of undefined (reading 'invoke')".
 */
function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

/**
 * Signal the native window to become visible once the first frame
 * has been committed to the compositor. Uses rAF + setTimeout(0)
 * to ensure the browser has actually painted before the window
 * is shown — the same "ready-to-show" pattern used by Slack,
 * Linear, and VS Code.
 */
function showWindowOnFirstPaint(): void {
  requestAnimationFrame(() => {
    setTimeout(() => {
      getCurrentWindow().show();
    }, 0);
  });
}

const root = createRoot(document.getElementById("root")!);

if (isTauriRuntime()) {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  showWindowOnFirstPaint();
} else {
  root.render(
    <StrictMode>
      <TauriRequiredNotice />
    </StrictMode>,
  );
}

function TauriRequiredNotice() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#09090b",
        color: "#fafafa",
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
        padding: "2rem",
      }}
    >
      <div style={{ maxWidth: "28rem", textAlign: "center" }}>
        <h1
          style={{
            fontSize: "1.125rem",
            fontWeight: 600,
            marginBottom: "0.75rem",
          }}
        >
          Stigmer Desktop
        </h1>
        <p
          style={{
            fontSize: "0.875rem",
            color: "#a1a1aa",
            lineHeight: 1.6,
            marginBottom: "1.5rem",
          }}
        >
          This application requires the Tauri native runtime. You&rsquo;re
          viewing the Vite dev server in a regular browser, which does not
          have access to Tauri&rsquo;s native APIs.
        </p>
        <div
          style={{
            backgroundColor: "#18181b",
            border: "1px solid #27272a",
            borderRadius: "0.5rem",
            padding: "1rem 1.25rem",
            textAlign: "left",
          }}
        >
          <p
            style={{
              fontSize: "0.75rem",
              color: "#71717a",
              marginBottom: "0.5rem",
            }}
          >
            Start the desktop app from the repo root:
          </p>
          <code
            style={{
              fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
              fontSize: "0.875rem",
              color: "#fafafa",
            }}
          >
            make desktop-dev
          </code>
        </div>
        <p
          style={{
            fontSize: "0.75rem",
            color: "#52525b",
            marginTop: "1rem",
            lineHeight: 1.5,
          }}
        >
          Use the native Tauri window that opens, not this browser tab.
        </p>
      </div>
    </div>
  );
}
