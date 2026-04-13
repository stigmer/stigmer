"use client";

import { useCallback, useRef, useState } from "react";
import {
  Check,
  ExternalLink,
  Key,
  Plus,
  Shield,
  ShieldCheck,
} from "lucide-react";
import { ProviderPicker } from "@stigmer/react";
import { ScenarioPlayer } from "../../engine/ScenarioPlayer";
import { useNarrationManifest } from "../../engine/useNarrationManifest";
import { Cursor } from "../../engine/Cursor";
import {
  type StepInteractions,
  useStepInteractions,
} from "../../engine/useStepInteractions";
import { BrowserView } from "../../views/BrowserView";
import { ManagementShell } from "../../views/ManagementShell";
import { PulseHighlight } from "../../shared/PulseHighlight";
import { DEMO_BROWSER_ZOOM, DEMO_CONTENT_ZOOM, DEMO_PLAYER_CLASSES } from "../../shared/tokens";
import { type RegisterIdpStep, registerIdpSteps } from "./steps";

const noop = () => {};

// ---------------------------------------------------------------------------
// Auth provider dashboard (step 1)
// ---------------------------------------------------------------------------

function AuthDashboardPage() {
  return (
    <div className="flex h-full flex-col overflow-y-auto bg-gradient-to-b from-background to-muted/30 p-4">
      <div className="mb-3 flex items-center gap-2">
        <Shield className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">
          Auth0 — API Settings
        </h3>
      </div>

      <div className="mb-2.5 rounded-md border border-border bg-card p-2">
        <div className="mb-1 flex items-center gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            API Name
          </span>
        </div>
        <div className="rounded bg-muted px-2 py-1 font-mono text-xs text-foreground">
          Stigmer Platform API
        </div>
      </div>

      <div className="space-y-2.5">
        <SettingsRow
          icon={<Key className="h-3 w-3 text-muted-foreground" />}
          label="JWKS URI"
          value="https://acme.us.auth0.com/.well-known/jwks.json"
        />
        <SettingsRow
          icon={<ExternalLink className="h-3 w-3 text-muted-foreground" />}
          label="Issuer URL"
          value="https://acme.us.auth0.com/"
        />
        <div data-scroll-target="audience-field">
          <SettingsRow
            icon={<Shield className="h-3 w-3 text-muted-foreground" />}
            label="Audience (API Identifier)"
            value="https://api.stigmer.ai/"
          />
        </div>
      </div>

      <div className="mt-4 rounded-md border border-border bg-muted/30 p-2">
        <p className="text-xs text-muted-foreground">
          Copy these three values into your Stigmer Identity Provider
          configuration.
        </p>
      </div>
    </div>
  );
}

function SettingsRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-border bg-card p-2">
      <div className="mb-1 flex items-center gap-1.5">
        {icon}
        <span className="text-xs font-medium text-muted-foreground">
          {label}
        </span>
      </div>
      <div className="rounded bg-muted px-2 py-1 font-mono text-xs text-foreground">
        {value}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Provider list (step 2) — empty state with add button
// ---------------------------------------------------------------------------

function ProviderListContent() {
  return (
    <div className="p-3" style={{ zoom: DEMO_CONTENT_ZOOM }}>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Identity Providers</h2>
          <p className="text-[0.65rem] text-muted-foreground">
            Manage trusted authentication providers for your organization
          </p>
        </div>
        <div className="relative" data-cursor-target="add-btn">
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground"
          >
            <Plus className="h-3 w-3" />
            New identity provider
          </button>
          <PulseHighlight />
        </div>
      </div>
      <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-border py-8">
        <ShieldCheck className="mb-2 h-6 w-6 text-muted-foreground/40" />
        <p className="text-xs text-muted-foreground">
          No identity providers configured.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pick provider (step 3) — real SDK ProviderPicker
// ---------------------------------------------------------------------------

function PickProviderContent() {
  return (
    <div className="p-3" style={{ zoom: DEMO_CONTENT_ZOOM }}>
      <h2 className="mb-1 text-sm font-semibold">Identity Providers</h2>
      <WizardStepIndicator current="pick" />
      <p className="mb-3 text-[0.65rem] text-muted-foreground">
        Choose your identity provider to get started. Known providers will have
        their OIDC configuration auto-populated.
      </p>
      <ProviderPicker onSelect={noop} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Configure (step 4) — Auth0-specific fields (static)
// ---------------------------------------------------------------------------

function ConfigureContent() {
  return (
    <div className="p-3" style={{ zoom: DEMO_CONTENT_ZOOM }}>
      <h2 className="mb-1 text-sm font-semibold">Identity Providers</h2>
      <WizardStepIndicator current="configure" />
      <p className="mb-3 text-[0.65rem] text-muted-foreground">
        Enter your Auth0 details to auto-populate the OIDC configuration.
      </p>
      <div className="space-y-2.5">
        <StaticField label="Tenant name" value="acme" hint="The subdomain from your Auth0 tenant URL" />
        <StaticField label="Region" value="US" />
        <hr className="border-border/40" />
        <StaticField
          label="Display name"
          value="Acme Cloud Auth"
          hint="Human-readable name shown in the UI"
        />
        <StaticField
          label="Expected audience"
          value="https://api.stigmer.ai/"
          hint="The aud claim value expected in JWTs from this provider"
        />
      </div>
      <div className="mt-3 flex items-center gap-2">
        <div className="relative" data-cursor-target="continue-btn">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
          >
            Continue
          </button>
          <PulseHighlight />
        </div>
        <span className="text-xs text-muted-foreground">Back</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Registered (step 5) — success
// ---------------------------------------------------------------------------

function RegisteredContent() {
  return (
    <div className="p-3" style={{ zoom: DEMO_CONTENT_ZOOM }}>
      <div className="mb-3 flex items-center gap-2">
        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/10">
          <Check className="h-3 w-3 text-emerald-500" />
        </div>
        <div>
          <h2 className="text-sm font-semibold">Identity Provider Registered</h2>
          <p className="text-[0.65rem] text-muted-foreground">
            Stigmer can now validate JWTs from this provider
          </p>
        </div>
      </div>
      <div className="rounded-lg border border-border">
        <div className="border-b border-border px-3 py-2">
          <span className="text-xs font-semibold">Acme Cloud Auth</span>
          <span className="ml-2 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[0.6rem] font-medium text-emerald-600">
            Active
          </span>
        </div>
        <div className="divide-y divide-border text-xs">
          {[
            { label: "ID", value: "idp_01H8MZXY4K..." },
            { label: "Slug", value: "acme-cloud-auth" },
            { label: "JWKS URI", value: "https://acme.us.auth0.com/.well-known/jwks.json" },
            { label: "Issuers", value: "https://acme.us.auth0.com/" },
            { label: "Audience", value: "https://api.stigmer.ai/" },
          ].map((d) => (
            <div key={d.label} className="flex gap-2 px-3 py-1.5">
              <span className="w-16 shrink-0 text-muted-foreground">
                {d.label}
              </span>
              <span className="font-mono text-foreground">{d.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Wizard step indicator (matches SDK IdentityProviderWizard)
// ---------------------------------------------------------------------------

const WIZARD_STEPS = ["Provider", "Configure", "Review"] as const;
type WizardStepKey = "pick" | "configure" | "review";
const STEP_INDEX: Record<WizardStepKey, number> = {
  pick: 0,
  configure: 1,
  review: 2,
};

function WizardStepIndicator({ current }: { current: WizardStepKey }) {
  const currentIdx = STEP_INDEX[current];
  return (
    <nav
      aria-label="Wizard progress"
      className="mb-2 flex items-center gap-1.5"
    >
      {WIZARD_STEPS.map((label, i) => (
        <span key={label} className="flex items-center gap-1.5">
          {i > 0 && (
            <span
              className={`h-px w-4 ${i <= currentIdx ? "bg-primary/40" : "bg-border"}`}
            />
          )}
          <span
            className={`text-[0.65rem] font-medium ${
              i === currentIdx
                ? "text-primary"
                : i < currentIdx
                  ? "text-muted-foreground"
                  : "text-muted-foreground/50"
            }`}
          >
            {label}
          </span>
        </span>
      ))}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Shared static field
// ---------------------------------------------------------------------------

function StaticField({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-foreground">{label}</label>
      <div className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground">
        {value}
      </div>
      {hint && (
        <p className="text-[0.65rem] text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mid-step interactions (scroll / cursor synced to narration)
// ---------------------------------------------------------------------------

const INTERACTIONS: StepInteractions = {
  0: [
    { atPercent: 0.55, type: "scroll-to", target: "audience-field" },
  ],
};

// ---------------------------------------------------------------------------
// Cursor targets
// ---------------------------------------------------------------------------

function cursorTargetFor(step: RegisterIdpStep): string | undefined {
  switch (step.view) {
    case "provider-list":
      return "add-btn";
    case "configure-provider":
      return "continue-btn";
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Step renderer
// ---------------------------------------------------------------------------

function renderStep(step: RegisterIdpStep) {
  switch (step.view) {
    case "auth-dashboard":
      return (
        <BrowserView
          url="manage.auth0.com/dashboard/us/acme/apis"
          contentKey="dashboard"
          zoom={DEMO_BROWSER_ZOOM}
        >
          <AuthDashboardPage />
        </BrowserView>
      );

    case "provider-list":
      return (
        <ManagementShell
          activeNav="identity-providers"
          contentKey="list"
        >
          <ProviderListContent />
        </ManagementShell>
      );

    case "pick-provider":
      return (
        <ManagementShell
          activeNav="identity-providers"
          contentKey="pick"
          slideDirection="forward"
        >
          <PickProviderContent />
        </ManagementShell>
      );

    case "configure-provider":
      return (
        <ManagementShell
          activeNav="identity-providers"
          contentKey="configure"
          slideDirection="forward"
        >
          <ConfigureContent />
        </ManagementShell>
      );

    case "provider-registered":
      return (
        <ManagementShell
          activeNav="identity-providers"
          contentKey="registered"
          slideDirection="forward"
        >
          <RegisteredContent />
        </ManagementShell>
      );
  }
}

// ---------------------------------------------------------------------------
// Exported component
// ---------------------------------------------------------------------------

/**
 * Register IdP playback for the "Register an Identity Provider" guide page.
 *
 * Five-step walkthrough: gather OIDC values from auth dashboard →
 * open Identity Providers in Stigmer console → pick provider type
 * (real SDK ProviderPicker) → configure → registered.
 */
export function RegisterIdpPlayback() {
  const narrationManifest = useNarrationManifest("register-idp-playback");
  const containerRef = useRef<HTMLDivElement>(null);
  const [cursorTarget, setCursorTarget] = useState<string | undefined>();
  const [stepIndex, setStepIndex] = useState(0);

  const handleStepChange = useCallback(
    (step: RegisterIdpStep, index: number) => {
      setCursorTarget(cursorTargetFor(step));
      setStepIndex(index);
    },
    [],
  );

  useStepInteractions({
    stepIndex,
    interactions: INTERACTIONS,
    narrationManifest,
    containerRef,
    setCursorTarget,
    steps: registerIdpSteps,
  });

  return (
    <div ref={containerRef} className={DEMO_PLAYER_CLASSES}>
      <ScenarioPlayer
        steps={registerIdpSteps}
        narrationManifest={narrationManifest}
        onStepChange={handleStepChange}
      >
        {(step) => renderStep(step)}
      </ScenarioPlayer>
      <Cursor target={cursorTarget} containerRef={containerRef} />
    </div>
  );
}
