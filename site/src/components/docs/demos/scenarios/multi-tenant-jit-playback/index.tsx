"use client";

import { useCallback, useRef, useState } from "react";
import { Building2, Check, KeyRound } from "lucide-react";
import { ScenarioPlayer } from "../../engine/ScenarioPlayer";
import { useNarrationManifest } from "../../engine/useNarrationManifest";
import { Cursor } from "../../engine/Cursor";
import { useStepInteractions } from "../../engine/useStepInteractions";
import { CodeEditorView, type FileTreeEntry } from "../../views/CodeEditorView";
import { TerminalView } from "../../views/TerminalView";
import { BrowserView } from "../../views/BrowserView";
import { APIExchangeView } from "../../views/APIExchangeView";
import { DEMO_BROWSER_ZOOM } from "../../shared/tokens";
import { DemoViewport } from "../../engine/DemoViewport";
import {
  type MultiTenantJitStep,
  multiTenantJitSteps,
  REGISTER_IDP_JIT_CODE,
  CREATE_TENANT_ORG_CODE,
  ORG_CREATED_OUTPUT,
  TENANT_RESOLVE_CHECKS,
  SUCCESS_CHECKS,
  MT_JIT_INTERACTIONS,
} from "./steps";

// ---------------------------------------------------------------------------
// File tree
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
// Inline content — JWT card with tenant claim
// ---------------------------------------------------------------------------

function TenantJwtCard() {
  return (
    <div className="flex h-full items-center justify-center bg-gradient-to-b from-background to-muted/30">
      <div className="w-60 space-y-2 text-center">
        <div className="mx-auto flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/10">
          <Check className="h-3.5 w-3.5 text-emerald-500" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            Welcome, Jane!
          </h3>
          <p className="text-xs text-muted-foreground">
            Authenticated via Auth0 on Tenant Alpha
          </p>
        </div>
        <div className="rounded-md border border-border bg-muted/50 p-1.5 text-left">
          <p className="mb-0.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            JWT payload
          </p>
          <div className="space-y-0.5 font-mono text-xs text-muted-foreground">
            <div>
              <span className="text-primary">&quot;sub&quot;</span>
              {": "}
              <span>&quot;auth0|jane_doe_123&quot;</span>
            </div>
            <div>
              <span className="text-primary">&quot;aud&quot;</span>
              {": "}
              <span>&quot;https://api.stigmer.ai/&quot;</span>
            </div>
            <div className="rounded bg-primary/10 px-1 py-0.5">
              <span className="font-semibold text-primary">
                &quot;org_id&quot;
              </span>
              {": "}
              <span className="text-foreground">
                &quot;acme-tenant-alpha-id&quot;
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-center gap-1">
          <KeyRound className="h-3 w-3 text-primary" />
          <p className="text-xs font-medium text-primary">
            Tenant claim routes to correct org
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step renderer
// ---------------------------------------------------------------------------

function renderStep(step: MultiTenantJitStep) {
  switch (step.view) {
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
          zoom={DEMO_BROWSER_ZOOM}
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

// ---------------------------------------------------------------------------
// Exported component
// ---------------------------------------------------------------------------

/**
 * Multi-tenant JIT playback for the federation guide.
 *
 * Six-step walkthrough: register IdP with JIT + tenantOrgClaim →
 * create tenant org → org created → JWT auth with org_id claim →
 * automatic tenant resolution + provisioning → success in tenant.
 */
export function MultiTenantJitPlayback() {
  const narrationManifest = useNarrationManifest("multi-tenant-jit-playback");
  const containerRef = useRef<HTMLDivElement>(null);
  const [cursorTarget, setCursorTarget] = useState<string | undefined>();
  const [stepIndex, setStepIndex] = useState(0);

  const handleStepChange = useCallback(
    (_step: MultiTenantJitStep, index: number) => {
      setCursorTarget(undefined);
      setStepIndex(index);
    },
    [],
  );

  useStepInteractions({
    stepIndex,
    interactions: MT_JIT_INTERACTIONS,
    narrationManifest,
    containerRef,
    setCursorTarget,
    steps: multiTenantJitSteps,
  });

  return (
    <DemoViewport containerRef={containerRef}>
      <ScenarioPlayer
        steps={multiTenantJitSteps}
        narrationManifest={narrationManifest}
        onStepChange={handleStepChange}
      >
        {(step) => renderStep(step)}
      </ScenarioPlayer>
      <Cursor target={cursorTarget} containerRef={containerRef} />
    </DemoViewport>
  );
}
