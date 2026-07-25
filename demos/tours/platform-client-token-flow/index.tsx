import type { CSSProperties, ReactNode } from "react";
import { Check, Code2, Zap } from "lucide-react";
import { BrowserView, LoginCardPage, TerminalView } from "@scenar/react";
import { APIExchangeView } from "../_shared/api-exchange/APIExchangeView";
import type { TokenFlowStep } from "./steps";
import {
  MINT_CALL_LINES,
  TOKEN_RESPONSE_LINES,
  ERROR_UNAUTHENTICATED_LINES,
  ERROR_NOT_FOUND_LINES,
  CREDENTIAL_CHECKS,
  USER_TOKEN_CHECKS,
  USER_TOKEN_RESULT,
} from "./steps";

// BrowserView shells render slightly below 1.0 so the mockup sits comfortably
// in the docs column (ported from the in-repo demo's DEMO_BROWSER_ZOOM).
const BROWSER_ZOOM = 0.9;

// Semantic "success" green — fixed, does not need to theme.
const EMERALD = "#10b981";

// ---------------------------------------------------------------------------
// Inline page content — the embedded-Stigmer dashboard. Rebuilt with
// --scenar-* tokens (no Tailwind utilities, which no-op under `scenar pack`);
// see coding-guidelines/tailwind-to-scenar-tokens.md. The neutral "primary"
// maps to --scenar-primary (the docs --primary is itself near-black/white).
// ---------------------------------------------------------------------------

const featureRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.375rem",
};

const featureText: CSSProperties = {
  fontSize: "0.75rem",
  color: "var(--scenar-foreground)",
};

function StigmerEmbeddedPage() {
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
          width: "15rem",
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          gap: "0.5rem",
        }}
      >
        <div
          style={{
            margin: "0 auto",
            display: "flex",
            height: "1.5rem",
            width: "1.5rem",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "9999px",
            background: "color-mix(in srgb, " + EMERALD + " 12%, transparent)",
          }}
        >
          <Check size={14} style={{ color: EMERALD }} aria-hidden />
        </div>

        <div>
          <h3 style={{ margin: 0, fontSize: "0.875rem", fontWeight: 600, color: "var(--scenar-foreground)" }}>
            Welcome, Jane!
          </h3>
          <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--scenar-muted-foreground)" }}>
            Stigmer components ready
          </p>
        </div>

        <div
          style={{
            borderRadius: "0.375rem",
            border: "1px solid var(--scenar-border)",
            background: "var(--scenar-accent)",
            padding: "0.5rem",
            textAlign: "left",
          }}
        >
          <p
            style={{
              marginTop: 0,
              marginBottom: "0.25rem",
              fontSize: "0.75rem",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: "var(--scenar-muted-foreground)",
            }}
          >
            StigmerProvider initialized
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <div style={featureRow}>
              <Zap size={12} style={{ color: "var(--scenar-primary)" }} aria-hidden />
              <span style={featureText}>getAccessToken wired</span>
            </div>
            <div style={featureRow}>
              <Code2 size={12} style={{ color: "var(--scenar-primary)" }} aria-hidden />
              <span style={featureText}>SessionComposer, MessageThread</span>
            </div>
          </div>
        </div>

        <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--scenar-muted-foreground)" }}>
          Jane can now use agents, sessions, and tools
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step renderer — pure (data) -> ReactNode. The player, cursor, narration, and
// viewport are provided by the packed embed entry.
// ---------------------------------------------------------------------------

export function renderStep(data: TokenFlowStep): ReactNode {
  switch (data.view) {
    case "platform-login":
      return (
        <BrowserView url="app.acme.com/login" contentKey="login" zoom={BROWSER_ZOOM}>
          <LoginCardPage
            appName="Acme Dashboard"
            subtitle="Sign in to your account"
            fields={[
              { label: "Email", value: "jane@acme.com" },
              { label: "Password", type: "password" },
            ]}
            submitLabel="Sign in"
            submitTargetId="sign-in-btn"
          />
        </BrowserView>
      );

    case "backend-mint":
      return (
        <TerminalView
          title="Your Backend — mintUserToken"
          contentKey="mint-call"
          lines={MINT_CALL_LINES}
        />
      );

    case "stigmer-validates-credentials":
      return (
        <APIExchangeView
          title="Stigmer API — Credential Validation"
          contentKey="validate-creds"
          request={{
            method: "POST",
            url: "/iam/v1/platformclient/mintUserToken",
            header: "client_id: stgm_cid_d3m0kEy... / client_secret: ••••",
          }}
          checks={CREDENTIAL_CHECKS}
        />
      );

    case "token-response":
      return (
        <TerminalView
          title="Your Backend — Token Response"
          contentKey="token-response"
          lines={TOKEN_RESPONSE_LINES}
        />
      );

    case "frontend-uses-token":
      return (
        <BrowserView
          url="app.acme.com/dashboard"
          contentKey="dashboard"
          slideDirection="forward"
          zoom={BROWSER_ZOOM}
        >
          <StigmerEmbeddedPage />
        </BrowserView>
      );

    case "stigmer-validates-user-token":
      return (
        <APIExchangeView
          title="Stigmer API — User Token Validation"
          contentKey="validate-user"
          request={{
            method: "POST",
            url: "/agentic/v1/sessions",
            header: "Authorization: Bearer eyJhbGciOiJFZDI1NTE5Iiwi...",
          }}
          checks={USER_TOKEN_CHECKS}
          result={USER_TOKEN_RESULT}
        />
      );

    case "error-unauthenticated":
      return (
        <TerminalView
          title="Error — Invalid Credentials"
          contentKey="error-unauth"
          lines={ERROR_UNAUTHENTICATED_LINES}
        />
      );

    case "error-not-found":
      return (
        <TerminalView
          title="Error — User Not Found"
          contentKey="error-notfound"
          slideDirection="forward"
          lines={ERROR_NOT_FOUND_LINES}
        />
      );
  }
}
