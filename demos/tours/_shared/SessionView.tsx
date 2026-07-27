import { useEffect, useMemo, useRef } from "react";
import {
  ARTIFACT_DOCUMENT_ENTRY_ID,
  ArtifactDocument,
  artifactKey,
  MessageThread,
  PanelChip,
  SessionComposer,
  SessionViewerLayout,
  useSessionArtifacts,
  useSessionRailViews,
  useSessionWriteBacks,
  WorkspaceSurface,
  type SessionComposerHandle,
  type SurfaceVirtualDocument,
} from "@stigmer/react";
import type { ResourceRef } from "@stigmer/sdk";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { DEMO_ORG, MOCK_WORKSPACE } from "./fixtures";
import "./SessionView.css";

const noop = () => {};

/**
 * The session panel facets a tour can open. Mirrors the ids
 * `useSessionRailViews` composes; a facet the depicted execution does not
 * offer (e.g. `"artifacts"` with no artifacts) degrades to the first
 * offered view — the surface's own stale-id rule.
 */
export type SessionPanelFacetId = "artifacts" | "usage" | "changes";

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
   * Pre-selected agent shown in the composer's toolbar trigger (e.g. the
   * Agent Creator a "new agent" flow opens with). Display-only in a demo —
   * selection callbacks are inert.
   */
  readonly agentRef?: ResourceRef | null;
  /** Placeholder for the `SessionComposer` textarea. */
  readonly placeholder?: string;
  /**
   * Heading rendered above the composer in the empty/typing state, as the
   * real `NewSessionViewer` does (e.g. "Add an Agent" in a draft session,
   * "What would you like to work on?" on the home screen).
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
 * `responsive={false}` (the embed iframe's viewport sits below `lg`, where
 * the default would hide the conversation on open-panel beats) and no
 * `splitStorageKey` (a persisted pane width would make replays
 * reader-dependent). Everything else enters as props from step data; the
 * root is `inert`, so the depicted page is non-interactive during playback.
 */
export function SessionView({
  execution,
  showApprovals = false,
  typingMessage,
  agentRef,
  placeholder = "Describe your agent...",
  heading,
  panelView,
  openArtifactName,
}: SessionViewProps) {
  if (execution) {
    return (
      <ThreadState
        execution={execution}
        showApprovals={showApprovals}
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
  panelView,
  openArtifactName,
}: {
  readonly execution: AgentExecution;
  readonly showApprovals: boolean;
  readonly panelView?: SessionPanelFacetId;
  readonly openArtifactName?: string;
}) {
  const executions = useMemo(() => [execution], [execution]);

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
    // Conscious simplification: no Config facet. An honest SetupTab needs
    // agent/harness/model/session-variable fixtures on every session beat,
    // and the beats that open the panel are about its execution facets. The
    // console's rail always carries Config, so this is a depicted-fidelity
    // gap — revisit if a tour ever narrates session configuration.
    sessionConfig: undefined,
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
  readonly heading?: string;
}) {
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
              {heading && <h1 className="sx-session__heading">{heading}</h1>}
              {typingMessage ? (
                <TypingComposer message={typingMessage} placeholder={placeholder} />
              ) : (
                <SessionComposer
                  onSubmit={noop}
                  placeholder={placeholder}
                  autoFocus={false}
                  workspace={MOCK_WORKSPACE}
                  org={DEMO_ORG}
                  agentRef={agentRef}
                  onAgentRefChange={noop}
                  onMcpServerUsagesChange={noop}
                  onSkillRefsChange={noop}
                />
              )}
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
 */
function TypingComposer({
  message,
  placeholder,
}: {
  readonly message: string;
  readonly placeholder: string;
}) {
  const composerRef = useRef<SessionComposerHandle>(null);

  useEffect(() => {
    composerRef.current?.setMessage(message);
  }, [message]);

  return (
    <SessionComposer
      ref={composerRef}
      onSubmit={noop}
      placeholder={placeholder}
      autoFocus={false}
      workspace={MOCK_WORKSPACE}
      org={DEMO_ORG}
      onAgentRefChange={noop}
      onMcpServerUsagesChange={noop}
      onSkillRefsChange={noop}
    />
  );
}
