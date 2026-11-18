import { Component, StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./fonts.css";
import "./globals.css";
import { App } from "./App";
import { BootFailure } from "./shell/BootFailure";

/**
 * The app's last resort: a failure while it draws itself, before any screen
 * of its own can say so. It renders before every provider, so it stands on
 * the kit's standalone frame inside the pre-app colour scheme, with the
 * failure in the console's words; the stack goes to Copy details, for
 * whoever fixes it, and never onto the screen.
 */
class BootErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return <BootFailure error={this.state.error} />;
    }
    return this.props.children;
  }
}


/**
 * Tauri v2 injects `__TAURI_INTERNALS__` into the webview at startup.
 * Regular browsers don't have it, so any @tauri-apps/* API call would
 * crash with "Cannot read properties of undefined (reading 'invoke')".
 */
function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

/**
 * Signal the native window to become visible.
 *
 * Tauri creates the window with `visible: false` so the user never
 * sees an empty white frame while JS boots. Once the React tree is
 * synchronously queued we call `show()` on a short timeout — this
 * unblocks the event loop so the first paint can be composited.
 *
 * Note: `requestAnimationFrame` is unreliable here because WebKit
 * may skip animation callbacks for windows that are not yet visible,
 * creating a deadlock (hidden → no rAF → no show → stays hidden).
 */
function showWindowOnFirstPaint(): void {
  setTimeout(() => {
    getCurrentWindow().show();
  }, 80);
}

const root = createRoot(document.getElementById("root")!);

if (isTauriRuntime()) {
  root.render(
    <StrictMode>
      <BootErrorBoundary>
        <App />
      </BootErrorBoundary>
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
            fontSize: "var(--stgm-text-lg)",
            fontWeight: 600,
            marginBottom: "0.75rem",
          }}
        >
          Stigmer Desktop
        </h1>
        <p
          style={{
            fontSize: "var(--stgm-text-sm)",
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
              fontSize: "var(--stgm-text-xs)",
              color: "#71717a",
              marginBottom: "0.5rem",
            }}
          >
            Start the desktop app from the repo root:
          </p>
          <code
            style={{
              fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
              fontSize: "var(--stgm-text-sm)",
              color: "#fafafa",
            }}
          >
            make desktop-dev
          </code>
        </div>
        <p
          style={{
            fontSize: "var(--stgm-text-xs)",
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
