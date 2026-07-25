import type { CSSProperties, ReactNode } from "react";
import { Check, KeyRound } from "lucide-react";
import {
  CodeEditorView,
  type FileTreeEntry,
  TerminalView,
  BrowserView,
} from "@scenar/react";
import { APIExchangeView } from "../_shared/api-exchange/APIExchangeView";
import type { MultiTenantJitStep } from "./steps";
import {
  REGISTER_IDP_JIT_CODE,
  CREATE_TENANT_ORG_CODE,
  ORG_CREATED_OUTPUT,
  TENANT_RESOLVE_CHECKS,
  SUCCESS_CHECKS,
} from "./steps";

// BrowserView shells render slightly below 1.0 so the mockup sits comfortably in
// the docs column (ported from the in-repo demo's DEMO_BROWSER_ZOOM).
const BROWSER_ZOOM = 0.9;

const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
// Semantic colors (do not need to theme): brand accent + success green. These
// mirror APIExchangeView's fixed status hues.
const ACCENT = "#3b82f6";
const EMERALD = "#10b981";

// ---------------------------------------------------------------------------
// File tree (CodeEditorView sidebar)
// ---------------------------------------------------------------------------

const FILE_TREE: FileTreeEntry[] = [
  { name: "src", type: "folder", depth: 0 },
  { name: "tenants", type: "folder", depth: 1 },
  { name: "register-idp.ts", type: "file", depth: 2 },
  { name: "onboard-tenant.ts", type: "file", depth: 2 },
  { name: "federation", type: "folder", depth: 1 },
  { name: "verify-idp.ts", type: "file", depth: 2 },
  { name: "package.json", type: "file", depth: 0 },
];

// ---------------------------------------------------------------------------
// Inline page content — JWT card with the tenant (org_id) claim highlighted.
// Rebuilt with --scenar-* tokens (no Tailwind utilities, which no-op under
// `scenar pack`); see coding-guidelines/tailwind-to-scenar-tokens.md.
// ---------------------------------------------------------------------------

const jwtKey: CSSProperties = { color: ACCENT };
const jwtMuted: CSSProperties = { color: "var(--scenar-muted-foreground)" };

function TenantJwtCard() {
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
          <h3
            style={{
              fontSize: "0.875rem",
              fontWeight: 600,
              color: "var(--scenar-foreground)",
              margin: 0,
            }}
          >
            Welcome, Jane!
          </h3>
          <p style={{ fontSize: "0.75rem", margin: 0, ...jwtMuted }}>
            Authenticated via Auth0 on Tenant Alpha
          </p>
        </div>

        <div
          style={{
            borderRadius: "0.375rem",
            border: "1px solid var(--scenar-border)",
            background: "var(--scenar-accent)",
            padding: "0.375rem",
            textAlign: "left",
          }}
        >
          <p
            style={{
              marginTop: 0,
              marginBottom: "0.125rem",
              fontSize: "0.75rem",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              ...jwtMuted,
            }}
          >
            JWT payload
          </p>
          <div style={{ fontFamily: MONO, fontSize: "0.75rem", lineHeight: 1.6 }}>
            <div style={jwtMuted}>
              <span style={jwtKey}>&quot;sub&quot;</span>
              {": "}
              <span>&quot;auth0|jane_doe_123&quot;</span>
            </div>
            <div style={jwtMuted}>
              <span style={jwtKey}>&quot;aud&quot;</span>
              {": "}
              <span>&quot;https://api.stigmer.ai/&quot;</span>
            </div>
            <div
              style={{
                borderRadius: "0.25rem",
                padding: "0.125rem 0.25rem",
                background: "color-mix(in srgb, " + ACCENT + " 10%, transparent)",
              }}
            >
              <span style={{ ...jwtKey, fontWeight: 600 }}>&quot;org_id&quot;</span>
              {": "}
              <span style={{ color: "var(--scenar-foreground)" }}>
                &quot;acme-tenant-alpha-id&quot;
              </span>
            </div>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.25rem",
          }}
        >
          <KeyRound size={12} style={{ color: ACCENT }} aria-hidden />
          <p style={{ fontSize: "0.75rem", fontWeight: 500, margin: 0, color: ACCENT }}>
            Tenant claim routes to correct org
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step renderer — pure (data) -> ReactNode. The player, cursor, narration, and
// viewport are provided by the packed embed entry.
// ---------------------------------------------------------------------------

export function renderStep(data: MultiTenantJitStep): ReactNode {
  switch (data.view) {
    case "code-register-idp":
      return (
        <CodeEditorView
          filename="register-idp.ts"
          lines={REGISTER_IDP_JIT_CODE}
          highlightLines={[8, 9, 10, 11]}
          fileTree={FILE_TREE}
          contentKey="register-idp"
        />
      );

    case "code-create-org":
      return (
        <CodeEditorView
          filename="onboard-tenant.ts"
          lines={CREATE_TENANT_ORG_CODE}
          highlightLines={[5, 6, 7, 8, 9, 10, 11]}
          fileTree={FILE_TREE}
          contentKey="create-org"
        />
      );

    case "terminal-org-created":
      return (
        <TerminalView
          title="Terminal — zsh"
          lines={ORG_CREATED_OUTPUT}
          contentKey="org-created"
        />
      );

    case "jwt-auth":
      return (
        <BrowserView
          url="tenant-alpha.acme.cloud/dashboard"
          contentKey="jwt-auth"
          zoom={BROWSER_ZOOM}
        >
          <TenantJwtCard />
        </BrowserView>
      );

    case "tenant-resolved":
      return (
        <APIExchangeView
          title="Stigmer API — Tenant Resolution (JIT)"
          contentKey="tenant-resolved"
          request={{
            method: "POST",
            url: "/agentic/v1/sessions",
            header: "Authorization: Bearer eyJhbGciOiJSUzI1NiIs...",
          }}
          checks={TENANT_RESOLVE_CHECKS}
          result={{
            label: "Tenant resolved — account provisioned",
            status: "pass",
          }}
        />
      );

    case "success":
      return (
        <APIExchangeView
          title="Stigmer API — Request Authorized"
          contentKey="success"
          request={{
            method: "POST",
            url: "/agentic/v1/sessions",
            header: "Authorization: Bearer eyJhbGciOiJSUzI1NiIs...",
          }}
          checks={SUCCESS_CHECKS}
          result={{
            label: "200 OK — Session created in tenant-alpha",
            status: "pass",
          }}
        />
      );
  }
}
