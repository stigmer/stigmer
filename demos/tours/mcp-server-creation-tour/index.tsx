/**
 * Pure `renderStep` for the MCP server creation tour. The player, cursor,
 * narration, and viewport are supplied by `scenar pack` — this file only maps
 * step data to views.
 *
 * The wizard beats compose the REAL `@stigmer/react` creation surface:
 * `WizardShell` (controlled chrome), `CreationPicker`, and the exported
 * presentational steps (`IdentityTransportStep`, `EnvironmentAuthStep`,
 * `ReviewStep`). Every state — including the validation failure and the
 * create error — is injected via props from `steps.ts`, so scrubbing and
 * video export reproduce each beat exactly (no synthetic events, ever).
 *
 * The real components sit inside an `inert` wrapper: it neutralizes
 * `IdentityTransportStep`'s name-field autofocus (which would steal keyboard
 * focus from the player mid-playback) and makes the depicted form
 * non-interactive — the correct semantic for a playback.
 *
 * The import beat is a tour-local replica of `ApplyManifestDialog`: the real
 * dialog opens with `<dialog>.showModal()`, which escapes to the browser top
 * layer where the embed's CSS zoom does not apply (it would render unscaled
 * over the player controls). The replica renders the same visual inside the
 * canonical container instead.
 */
import type { CSSProperties, ReactNode } from "react";
import { ConnectError, Code } from "@connectrpc/connect";
import {
  createInitialMcpServerWizardData,
  CreationPicker,
  EnvironmentAuthStep,
  IdentityTransportStep,
  MCP_SERVER_TEMPLATES,
  ReviewStep,
  WizardShell,
} from "@stigmer/react";
import type { McpServerWizardData, WizardStepDef } from "@stigmer/react";
import { AppShell } from "../_shared/AppShell";
import { ORDER_MGMT_MCP } from "../_shared/fixtures";
import { ResourceListPage } from "../_shared/ResourceListPage";
import {
  type IdentityFormPhase,
  type McpServerCreationTourStep,
  ALL_SERVERS,
  DEMO_ORG,
  EXISTING_SERVERS,
  MCP_SERVER_YAML,
} from "./steps";
import "./tour.css";

const noop = () => {};

// ---------------------------------------------------------------------------
// Wizard-data snapshots (one per beat)
// ---------------------------------------------------------------------------
// These live here rather than in steps.ts because `scenar narrate` imports
// steps.ts in a plain Node process — steps.ts must stay free of component-
// package imports. Each snapshot is the exact state a user would have
// reached at that point of the form; later snapshots extend earlier ones,
// so the tour reads as one continuous session.

/** Step 1 as it first opens: the untouched form. */
const IDENTITY_EMPTY: McpServerWizardData = createInitialMcpServerWizardData();

/**
 * The user filled the identity fields but clicked Next before entering the
 * HTTP URL — the state that trips the wizard's real step validation.
 */
const IDENTITY_INVALID: McpServerWizardData = {
  ...IDENTITY_EMPTY,
  name: ORDER_MGMT_MCP.name,
  slug: ORDER_MGMT_MCP.slug,
  description: ORDER_MGMT_MCP.description,
};

/** The exact message the wizard's step-1 validation produces for this state. */
const IDENTITY_VALIDATION_ERROR = "HTTP URL is required";

/** The corrected step 1: URL supplied, auth header wired to an env var. */
const IDENTITY_COMPLETE: McpServerWizardData = {
  ...IDENTITY_INVALID,
  httpUrl: ORDER_MGMT_MCP.url,
  httpHeaders: [
    { key: "Authorization", value: `Bearer \${${ORDER_MGMT_MCP.envKey}}` },
  ],
};

/** Step 2: the secret the `${API_TOKEN}` header placeholder resolves from. */
const WITH_ENV: McpServerWizardData = {
  ...IDENTITY_COMPLETE,
  env: [
    {
      key: ORDER_MGMT_MCP.envKey,
      description: ORDER_MGMT_MCP.envDescription,
      isSecret: true,
      optional: false,
    },
  ],
};

const IDENTITY_BY_PHASE: Record<
  IdentityFormPhase,
  { data: McpServerWizardData; validationError: string | null }
> = {
  empty: { data: IDENTITY_EMPTY, validationError: null },
  invalid: { data: IDENTITY_INVALID, validationError: IDENTITY_VALIDATION_ERROR },
  complete: { data: IDENTITY_COMPLETE, validationError: null },
};

/**
 * The server error shown on the failed create: a realistic Connect
 * `already_exists` — `ReviewStep` renders it through the SDK's
 * `getUserMessage`, so the beat shows exactly what a live user sees.
 */
const CREATE_CONFLICT_ERROR: Error = new ConnectError(
  `an MCP server with slug "${ORDER_MGMT_MCP.slug}" already exists in org "${DEMO_ORG}"`,
  Code.AlreadyExists,
);

/**
 * Mirrors the real `McpServerCreationWizard`'s step definitions — same ids,
 * same labels — so the `WizardShell` step indicator reads identically to the
 * console. Validation lives in `steps.ts` as pre-computed state; the defs
 * here only drive the indicator.
 */
const WIZARD_STEPS: WizardStepDef<McpServerWizardData>[] = [
  { id: "identity-transport", label: "Identity & Transport" },
  { id: "environment-auth", label: "Environment & Auth" },
  { id: "review", label: "Review & Create" },
];

/** Placeholder content area before the tour navigates anywhere. */
const HOME_HINT: CSSProperties = {
  display: "flex",
  height: "100%",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
  fontSize: 12,
  color: "var(--stgm-muted-foreground)",
};

/**
 * Renders one wizard beat: the real `WizardShell` chrome around the active
 * real step component, pinned to the content area's height so the footer
 * (with its `wizard-next` cursor target) is always on screen and long step
 * content scrolls internally, exactly like the console.
 */
function WizardFrame({
  stepIndex,
  children,
}: {
  readonly stepIndex: number;
  readonly children: ReactNode;
}) {
  return (
    <div className="mcp-wizard" inert>
      <WizardShell
        steps={WIZARD_STEPS}
        currentStepIndex={stepIndex}
        submitLabel="Create MCP server"
        canGoBack={stepIndex > 0}
        onNext={noop}
        onBack={noop}
        onCancel={noop}
      >
        {children}
      </WizardShell>
    </div>
  );
}

/**
 * Tour-local replica of `ApplyManifestDialog` (see the file header for why
 * the real one can't render in an embed): header, pasted manifest, the
 * per-document "Will create" preview row, and the action footer — over a
 * dimmed MCP Servers list, like the console's modal backdrop.
 */
function ImportManifestOverlay() {
  return (
    <div className="mcp-import">
      <div className="mcp-import__underlay" inert>
        <ResourceListPage
          title="MCP Servers"
          createLabel="Add MCP Server"
          cursorTarget="create-mcp-server"
          items={EXISTING_SERVERS}
          layout="grid"
        />
      </div>

      <div className="mcp-import__backdrop">
        <div className="mcp-import__dialog" role="dialog" aria-label="Apply YAML">
          <h3 className="mcp-import__title">Apply YAML</h3>
          <p className="mcp-import__subtitle">
            Paste a resource manifest or upload a file. Resources are created
            when new and updated when they already exist.
          </p>

          <pre className="mcp-import__yaml">{MCP_SERVER_YAML}</pre>

          <div className="mcp-import__row">
            <span className="mcp-import__kind">McpServer</span>
            <span className="mcp-import__name">{ORDER_MGMT_MCP.name}</span>
            <span className="mcp-import__badge">Will create</span>
            <span className="mcp-import__org">{DEMO_ORG}</span>
          </div>

          <div className="mcp-import__actions">
            <span className="mcp-import__button mcp-import__button--secondary">
              Cancel
            </span>
            <span className="mcp-import__button mcp-import__button--primary">
              Apply
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function renderStep(data: McpServerCreationTourStep): ReactNode {
  switch (data.view) {
    case "home":
      return (
        <AppShell contentKey="home">
          <div style={HOME_HINT}>Start a new session</div>
        </AppShell>
      );

    case "library-click":
      return (
        <AppShell highlightNav="library" contentKey="home">
          <div style={HOME_HINT}>Start a new session</div>
        </AppShell>
      );

    case "mcp-servers-list":
      return (
        <AppShell activeNav="library" contentKey="servers" slideDirection="forward">
          <ResourceListPage
            title="MCP Servers"
            createLabel="Add MCP Server"
            cursorTarget="create-mcp-server"
            items={EXISTING_SERVERS}
            layout="grid"
            highlightCreate
          />
        </AppShell>
      );

    case "creation-picker":
      return (
        <AppShell activeNav="library" contentKey="picker" slideDirection="forward">
          <div className="mcp-picker" inert>
            <CreationPicker
              resourceLabel="MCP server"
              templates={MCP_SERVER_TEMPLATES}
              onSelect={noop}
            />
          </div>
        </AppShell>
      );

    case "wizard-identity": {
      const { data: form, validationError } = IDENTITY_BY_PHASE[data.form];
      return (
        <AppShell activeNav="library" contentKey="wizard" slideDirection="forward">
          <WizardFrame stepIndex={0}>
            <IdentityTransportStep
              data={form}
              updateData={noop}
              validationError={validationError}
            />
          </WizardFrame>
        </AppShell>
      );
    }

    case "wizard-env-auth":
      return (
        <AppShell activeNav="library" contentKey="wizard">
          <WizardFrame stepIndex={1}>
            <EnvironmentAuthStep data={WITH_ENV} updateData={noop} />
          </WizardFrame>
        </AppShell>
      );

    case "wizard-review":
      return (
        <AppShell activeNav="library" contentKey="wizard">
          <WizardFrame stepIndex={2}>
            <ReviewStep
              org={DEMO_ORG}
              data={WITH_ENV}
              isCreating={false}
              error={data.failed ? CREATE_CONFLICT_ERROR : null}
            />
          </WizardFrame>
        </AppShell>
      );

    case "import-manifest":
      return (
        <AppShell activeNav="library" contentKey="import">
          <ImportManifestOverlay />
        </AppShell>
      );

    case "library-complete":
      return (
        <AppShell activeNav="library" contentKey="servers" slideDirection="backward">
          <ResourceListPage
            title="MCP Servers"
            createLabel="Add MCP Server"
            cursorTarget="create-mcp-server"
            items={ALL_SERVERS}
            layout="grid"
            showNewItem
          />
        </AppShell>
      );
  }
}
