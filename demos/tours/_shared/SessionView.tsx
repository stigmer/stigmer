import { useEffect, useMemo, useRef } from "react";
import {
  ARTIFACT_DOCUMENT_ENTRY_ID,
  ArtifactDocument,
  artifactKey,
  DEFAULT_HARNESS,
  MessageThread,
  PanelChip,
  SessionComposer,
  SessionViewerLayout,
  useSessionArtifacts,
  useSessionRailViews,
  useSessionWriteBacks,
  WorkspaceSurface,
  type SessionComposerHandle,
  type SessionComposerProps,
  type SetupTabProps,
  type SurfaceVirtualDocument,
} from "@stigmer/react";
import type { ResourceRef } from "@stigmer/sdk";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { DEMO_ORG, MOCK_WORKSPACE } from "./fixtures";
import "./SessionView.css";

const noop = () => {};

/**
 * The console home's launcher strings, transcribed from the real
 * `NewSessionViewer` prop defaults (sdk/react/src/session/
 * NewSessionViewer.tsx) — the same transcription convention this file's
 * CSS header uses for the pane metrics. With these as `SessionView`'s own
 * defaults, the zero-prop `<SessionView />` IS the console home at `/`,
 * exactly as the zero-prop `NewSessionViewer` is in the product
 * (stigmer/stigmer#321).
 */
const HOME_HEADING = "What would you like to work on?";
const HOME_PLACEHOLDER = "Describe what you need help with\u2026";

/**
 * The console's agent-draft launcher placeholder (the `/?draft=agent`
 * surface), transcribed from `DRAFT_PLACEHOLDERS.agent` in
 * client-apps/web/src/domain/session/SessionLauncher.tsx. Hoisted here
 * because two tours depict that surface (agent-creation-tour,
 * create-agent-tour) — demos/README.md's hoisting rule.
 */
export const AGENT_DRAFT_PLACEHOLDER =
  "Describe the agent you\u2019d like to build \u2014 its purpose, the skills " +
  "and MCP servers it should use, and any system instructions to " +
  "guide its behavior.";

/**
 * The session panel facets a tour can open. Mirrors the ids
 * `useSessionRailViews` composes; a facet the depicted execution does not
 * offer (e.g. `"artifacts"` with no artifacts) degrades to the first
 * offered view — the surface's own stale-id rule.
 */
export type SessionPanelFacetId = "configure" | "artifacts" | "usage" | "changes";

interface SessionViewProps {
  /** When set, renders the conversation via `MessageThread`. */
  readonly execution?: AgentExecution;
  /**
   * Render the execution's pending-approval gates inline on their tool rows.
   * `MessageThread` gates approval UI on the presence of an
   * `onApprovalSubmit` handler (`includeApprovals = onApprovalSubmit !=
   * null`) — but a playback has no decision to route, so the demo layer
   * names the *intent* and passes an inert handler to the SDK internally.
   * The depicted execution must carry `status.pendingApprovals` whose
   * `toolCallId` matches an inline tool call, or the gate falls through to
   * the bottom backstop card (which ticks an elapsed-time counter — a
   * DD-006 violation in a packed embed).
   */
  readonly showApprovals?: boolean;
  /**
   * When set, renders `SessionComposer` with its textarea pre-filled with this
   * text (simulating the user having typed a prompt).
   */
  readonly typingMessage?: string;
  /**
   * The depicted session's agent: shown in the composer's toolbar trigger
   * in the launcher state (e.g. the Agent Creator a "new agent" flow opens
   * with) and listed in the panel's Config facet in the session state.
   * Omitted, the session depicts the default agent. Display-only in a
   * demo — selection callbacks are inert.
   */
  readonly agentRef?: ResourceRef | null;
  /**
   * Placeholder for the `SessionComposer` textarea. Defaults to the
   * console home's own placeholder; a beat depicting a draft surface
   * passes that surface's real placeholder (e.g.
   * {@link AGENT_DRAFT_PLACEHOLDER} for `/?draft=agent`).
   */
  readonly placeholder?: string;
  /**
   * Heading rendered above the composer in the empty/typing state, as the
   * real `NewSessionViewer` does. Defaults to the console home's
   * "What would you like to work on?"; a draft beat passes its own (e.g.
   * "Add an Agent").
   */
  readonly heading?: string;
  /**
   * Opens the session panel on this facet (session mode only). Omitted, the
   * panel is collapsed to its top-right chip — the console's default state.
   */
  readonly panelView?: SessionPanelFacetId;
  /**
   * Opens this artifact (by `ExecutionArtifact.name`) as a document tab in
   * the panel's editor area — the shipped open-artifact presentation
   * (`ArtifactDocument`, Apply CTA included). Only meaningful with
   * `panelView` set; the named artifact must exist on the depicted
   * execution.
   */
  readonly openArtifactName?: string;
}

/**
 * The session surface used across demo scenarios, at the shipped console's
 * own composition: both states render inside the real `SessionViewerLayout`
 * (scenar-cloud DD-010) — the launcher state centers a `SessionComposer`
 * exactly as `NewSessionViewer` does, and the session state pairs a
 * `MessageThread` (its `contentColumn="center"` owning the reading-column
 * geometry) with the unified session panel: `PanelChip` toggle, and
 * `WorkspaceSurface` carrying the real facet rail from
 * `useSessionRailViews`.
 *
 * Two deliberate departures from the shipped viewers, both determinism
 * seams the layout exposes for exactly this host class (DD-006):
 * `responsive={false}` (the tour canvas is a narrow fixed box, where the
 * default container-width collapse would hide the conversation on exactly
 * the open-panel beats the tour is narrating) and no `splitStorageKey` (a
 * persisted pane width would make replays reader-dependent). Everything
 * else enters as props from step data; the root is `inert`, so the
 * depicted page is non-interactive during playback.
 */
export function SessionView({
  execution,
  showApprovals = false,
  typingMessage,
  agentRef,
  placeholder = HOME_PLACEHOLDER,
  heading = HOME_HEADING,
  panelView,
  openArtifactName,
}: SessionViewProps) {
  if (execution) {
    return (
      <ThreadState
        execution={execution}
        showApprovals={showApprovals}
        agentRef={agentRef}
        panelView={panelView}
        openArtifactName={openArtifactName}
      />
    );
  }
  return (
    <LauncherState
      typingMessage={typingMessage}
      agentRef={agentRef}
      placeholder={placeholder}
      heading={heading}
    />
  );
}

/**
 * The panel toggle in the layout's top-right corner, wrapped in a cursor
 * anchor so a step can point at it (`set_cursor` target `"panel-chip"`).
 * `isOpen` and the badge are pure functions of step data — the chip never
 * operates the panel in a demo.
 */
function panelChip(isOpen: boolean, badgeCount: number) {
  return (
    <span data-cursor-target="panel-chip" className="sx-session__chip-anchor">
      <PanelChip isOpen={isOpen} onToggle={noop} badgeCount={badgeCount} />
    </span>
  );
}

function ThreadState({
  execution,
  showApprovals,
  agentRef,
  panelView,
  openArtifactName,
}: {
  readonly execution: AgentExecution;
  readonly showApprovals: boolean;
  readonly agentRef?: ResourceRef | null;
  readonly panelView?: SessionPanelFacetId;
  readonly openArtifactName?: string;
}) {
  const executions = useMemo(() => [execution], [execution]);

  // The Config facet the console's rail always carries, at the shape
  // SessionViewer builds from its flow state: the depicted agent (default
  // agent when none is named), no attached MCP servers/skills/variables,
  // and the default harness — a fresh session's honest configuration.
  // Read-only by construction: no `mutations`, so SetupTab renders without
  // remove affordances (DD-011) — a paused frame depicts a session being
  // inspected, not reconfigured. Model/Target pills are omitted exactly as
  // the console omits them before an explicit selection.
  const sessionConfig = useMemo<SetupTabProps>(
    () => ({
      agentRef: agentRef ?? null,
      isDefaultAgent: agentRef == null,
      mcpServerUsages: [],
      skillRefs: [],
      sessionVariables: null,
      harness: DEFAULT_HARNESS,
      executionTarget: undefined,
      modelId: undefined,
    }),
    [agentRef],
  );

  // The console's own derivations (pure aggregations over the execution):
  // the chip badge is writeBackCount + artifactCount, exactly as
  // SessionViewer computes it, and the rail comes from useSessionRailViews
  // so labels, icons, badges, and contextual visibility can never drift
  // from the shipped panel.
  const { artifacts, artifactCount } = useSessionArtifacts(executions);
  const { writeBackCount } = useSessionWriteBacks(executions);
  const railViews = useSessionRailViews({
    allExecutions: executions,
    org: DEMO_ORG,
    sessionConfig,
    // Supplying the open-artifact callbacks (inert here) selects the
    // shipped document-tab flow inside ArtifactsTab — and keeps its modal
    // fallback, a top-layer <dialog>, out of the tree entirely (DD-006
    // rule 6 by construction).
    onOpenArtifact: noop,
    onActivateArtifact: noop,
  });

  const openEntry = openArtifactName
    ? artifacts.find((entry) => entry.artifact.name === openArtifactName)
    : undefined;
  const openKey = openEntry ? artifactKey(openEntry.artifact) : null;

  const virtualDocuments = useMemo<readonly SurfaceVirtualDocument[]>(() => {
    if (!openEntry || !openKey) return [];
    return [
      {
        entryId: ARTIFACT_DOCUMENT_ENTRY_ID,
        path: openKey,
        content: (
          <ArtifactDocument
            artifact={openEntry.artifact}
            executionId={openEntry.executionId}
            org={DEMO_ORG}
            isTerminal={openEntry.isTerminal}
          />
        ),
      },
    ];
  }, [openEntry, openKey]);

  return (
    <div className="sx-session" inert>
      <SessionViewerLayout
        responsive={false}
        chip={panelChip(panelView != null, writeBackCount + artifactCount)}
        conversation={
          <div className="sx-session__thread">
            <MessageThread
              executions={executions}
              onApprovalSubmit={showApprovals ? noop : undefined}
              contentColumn="center"
            />
          </div>
        }
        panel={
          panelView != null ? (
            <div data-cursor-target="session-panel" className="sx-session__panel">
              <WorkspaceSurface
                entries={[]}
                lister={undefined}
                reader={undefined}
                view={panelView}
                onViewChange={noop}
                // Facet-only rail (a shipped WorkspaceSurface pattern — the
                // workflow panel does the same): tours have no workspace
                // file source, and a disabled Explorer/Search would depict
                // an "unavailable here" state no configured console shows.
                builtInViews={[]}
                extraViews={railViews}
                virtualDocuments={virtualDocuments}
                editors={
                  openKey
                    ? [
                        {
                          entryId: ARTIFACT_DOCUMENT_ENTRY_ID,
                          path: openKey,
                          preview: true,
                        },
                      ]
                    : []
                }
                selectedFile={
                  openKey
                    ? { entryId: ARTIFACT_DOCUMENT_ENTRY_ID, path: openKey }
                    : null
                }
                onOpenFile={noop}
                onActivateEditor={noop}
                onPinEditor={noop}
                onCloseEditor={noop}
                onCollapse={noop}
                className="h-full"
              />
            </div>
          ) : null
        }
      />
    </div>
  );
}

function LauncherState({
  typingMessage,
  agentRef,
  placeholder,
  heading,
}: {
  readonly typingMessage?: string;
  readonly agentRef?: ResourceRef | null;
  readonly placeholder: string;
  readonly heading: string;
}) {
  // One composer wiring for both branches (static and typing), at the
  // values NewSessionViewer passes on the console home: 3 visible rows,
  // the harness selector and interaction-mode picker shown with the
  // default harness and "agent" mode selected, and the launcher's own
  // aria label — the composer chrome must not differ by whether a beat
  // types into it (stigmer/stigmer#321). Display-only as ever: every
  // callback is noop and the root is inert.
  const composerProps: SessionComposerProps = {
    onSubmit: noop,
    placeholder,
    initialRows: 3,
    autoFocus: false,
    workspace: MOCK_WORKSPACE,
    org: DEMO_ORG,
    agentRef,
    onAgentRefChange: noop,
    onMcpServerUsagesChange: noop,
    onSkillRefsChange: noop,
    showHarnessSelector: true,
    harness: DEFAULT_HARNESS,
    onHarnessChange: noop,
    showInteractionModePicker: true,
    interactionMode: "agent",
    onInteractionModeChange: noop,
    ariaLabel: "Start a new session",
  };

  return (
    <div className="sx-session" inert>
      <SessionViewerLayout
        responsive={false}
        // The launcher's chip renders bare (no badge) — NewSessionViewer
        // mounts it always-on, pre-session.
        chip={panelChip(false, 0)}
        conversation={
          <div className="sx-session__center">
            <div className="sx-session__center-inner">
              <h1 className="sx-session__heading">{heading}</h1>
              {typingMessage ? (
                <TypingComposer
                  message={typingMessage}
                  composerProps={composerProps}
                />
              ) : (
                <SessionComposer {...composerProps} />
              )}
              <p className="sx-session__enter-hint">
                Press Enter to send, Shift+Enter for a new line
              </p>
            </div>
          </div>
        }
        panel={null}
      />
    </div>
  );
}

/**
 * Renders `SessionComposer` looking mid-typing by seeding `message` through
 * the component's own public imperative handle
 * (`SessionComposerHandle.setMessage`) — the documented seam for setting the
 * composer's text from outside. State enters upstream through a supported
 * API (the DD-006 rule-7 shape, like `CreateApiKeyForm.initialName`), never
 * by dispatching synthetic DOM events at the textarea.
 *
 * The composer wiring arrives whole from `LauncherState` so the two
 * branches can never diverge — this branch once dropped `agentRef` by
 * re-listing the props by hand.
 */
function TypingComposer({
  message,
  composerProps,
}: {
  readonly message: string;
  readonly composerProps: SessionComposerProps;
}) {
  const composerRef = useRef<SessionComposerHandle>(null);

  useEffect(() => {
    composerRef.current?.setMessage(message);
  }, [message]);

  return <SessionComposer ref={composerRef} {...composerProps} />;
}
