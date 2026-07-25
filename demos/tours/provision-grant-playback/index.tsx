import type { CSSProperties, ReactNode } from "react";
import {
  BrowserView,
  CodeEditorView,
  type FileTreeEntry,
  PulseHighlight,
  TerminalView,
} from "@scenar/react";
import type { ProvisionGrantStep } from "./steps";
import {
  CHECK_CODE,
  CREATE_CODE,
  GRANT_CODE,
  NOT_FOUND_OUTPUT,
  CREATED_OUTPUT,
  GRANTED_OUTPUT,
} from "./steps";

// BrowserView shells render slightly below 1.0 so the mockup sits comfortably
// in the docs column (ported from the in-repo demo's DEMO_BROWSER_ZOOM).
const BROWSER_ZOOM = 0.9;

// ---------------------------------------------------------------------------
// File tree (CodeEditorView sidebar)
// ---------------------------------------------------------------------------

const FILE_TREE: FileTreeEntry[] = [
  { name: "src", type: "folder", depth: 0 },
  { name: "handlers", type: "folder", depth: 1 },
  { name: "onboard-user.ts", type: "file", depth: 2 },
  { name: "federation", type: "folder", depth: 1 },
  { name: "register-idp.ts", type: "file", depth: 2 },
  { name: "verify-idp.ts", type: "file", depth: 2 },
  { name: "package.json", type: "file", depth: 0 },
];

// ---------------------------------------------------------------------------
// Inline page content — signup card. Rebuilt with --scenar-* tokens (no
// Tailwind utilities, which no-op under `scenar pack`); see
// coding-guidelines/tailwind-to-scenar-tokens.md. The neutral "primary" pairs
// --scenar-primary (fill) with --scenar-surface (contrasting text).
// ---------------------------------------------------------------------------

const labelStyle: CSSProperties = {
  fontSize: "0.75rem",
  color: "var(--scenar-muted-foreground)",
};

const fieldValueStyle: CSSProperties = {
  borderRadius: "0.375rem",
  border: "1px solid var(--scenar-border)",
  background: "var(--scenar-surface)",
  padding: "0.125rem 0.5rem",
  fontSize: "0.75rem",
  color: "var(--scenar-foreground)",
};

function SignupField({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <div style={fieldValueStyle}>{value}</div>
    </div>
  );
}

function SignupPage() {
  return (
    <div
      style={{
        display: "flex",
        height: "100%",
        alignItems: "center",
        justifyContent: "center",
        background:
          "linear-gradient(to bottom, var(--scenar-surface), color-mix(in srgb, var(--scenar-accent) 30%, var(--scenar-surface)))",
      }}
    >
      <div
        style={{
          width: "13rem",
          borderRadius: "0.5rem",
          border: "1px solid var(--scenar-border)",
          background: "var(--scenar-card)",
          padding: "0.75rem",
          boxShadow: "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
        }}
      >
        <div style={{ marginBottom: "0.5rem", textAlign: "center" }}>
          <div
            style={{
              margin: "0 auto 0.25rem",
              display: "flex",
              height: "1.25rem",
              width: "1.25rem",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "0.375rem",
              background: "color-mix(in srgb, var(--scenar-primary) 10%, transparent)",
            }}
          >
            <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--scenar-primary)" }}>
              A
            </span>
          </div>
          <h3 style={{ margin: 0, fontSize: "0.875rem", fontWeight: 600, color: "var(--scenar-foreground)" }}>
            Acme Cloud
          </h3>
          <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--scenar-muted-foreground)" }}>
            Create your account
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
          <SignupField label="Name" value="Jane Doe" />
          <SignupField label="Email" value="jane@acme.com" />
          <div style={{ position: "relative" }} data-cursor-target="signup-btn">
            <div
              style={{
                borderRadius: "0.375rem",
                background: "var(--scenar-primary)",
                padding: "0.125rem 0",
                textAlign: "center",
                fontSize: "0.75rem",
                fontWeight: 500,
                color: "var(--scenar-surface)",
              }}
            >
              Create account
            </div>
            <PulseHighlight />
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step renderer — pure (data) -> ReactNode. The player, cursor, narration, and
// viewport are provided by the packed embed entry.
// ---------------------------------------------------------------------------

export function renderStep(data: ProvisionGrantStep): ReactNode {
  switch (data.view) {
    case "user-signup":
      return (
        <BrowserView url="acme.cloud/signup" contentKey="signup" zoom={BROWSER_ZOOM}>
          <SignupPage />
        </BrowserView>
      );

    case "code-check":
      return (
        <CodeEditorView
          filename="onboard-user.ts"
          lines={CHECK_CODE}
          highlightLines={[2, 3, 4, 5, 6]}
          fileTree={FILE_TREE}
          contentKey="check"
        />
      );

    case "terminal-not-found":
      return (
        <TerminalView title="Terminal — zsh" lines={NOT_FOUND_OUTPUT} contentKey="not-found" />
      );

    case "code-create":
      return (
        <CodeEditorView
          filename="onboard-user.ts"
          lines={CREATE_CODE}
          highlightLines={[1, 2, 3, 4, 5, 6, 7, 8, 9]}
          fileTree={FILE_TREE}
          contentKey="create"
        />
      );

    case "terminal-created":
      return (
        <TerminalView title="Terminal — zsh" lines={CREATED_OUTPUT} contentKey="created" />
      );

    case "code-grant":
      return (
        <CodeEditorView
          filename="onboard-user.ts"
          lines={GRANT_CODE}
          highlightLines={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]}
          fileTree={FILE_TREE}
          contentKey="grant"
        />
      );

    case "terminal-granted":
      return (
        <TerminalView title="Terminal — zsh" lines={GRANTED_OUTPUT} contentKey="granted" />
      );
  }
}
