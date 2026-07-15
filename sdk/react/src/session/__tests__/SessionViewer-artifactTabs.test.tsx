import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionArtifactSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";
import {
  ExecutionArtifactKind,
  ExecutionPhase,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { ARTIFACT_DOCUMENT_ENTRY_ID } from "../../execution/artifact-document";
import { artifactKey, type SessionArtifactEntry } from "../useSessionArtifacts";

// ---------------------------------------------------------------------------
// Wiring-contract test for the Artifacts facet's open/pin gestures. The
// `onOpenArtifact` (single-click preview) and `onActivateArtifact` (double-click
// pin) callbacks must thread from SessionViewer, through the intermediate
// SessionPanelRegion, into useSessionRailViews' <ArtifactsTab>, and — when
// invoked — land as an artifact virtual-document tab on the editors store.
// WorkspaceSurface renders as a prop-capturing probe; the store + panel-region
// wire between them is the subject under test. Tab MECHANICS (preview-slot
// reuse, pin promotion) live in workspace-editors-store.test.ts and are not
// re-tested here.
// ---------------------------------------------------------------------------

type CapturedProps = Record<string, unknown>;

const threadProps: CapturedProps[] = [];
vi.mock("../../execution/MessageThread", () => ({
  MessageThread: (props: CapturedProps) => {
    threadProps.push(props);
    return <div data-testid="thread-probe" />;
  },
}));

const surfaceProps: CapturedProps[] = [];
vi.mock("../../workspace/WorkspaceSurface", () => ({
  WorkspaceSurface: (props: CapturedProps) => {
    surfaceProps.push(props);
    return <div data-testid="surface-probe" />;
  },
}));

vi.mock("../../composer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../composer")>();
  return {
    ...actual,
    SessionComposer: () => <div data-testid="composer-probe" />,
  };
});

const artifact = create(ExecutionArtifactSchema, {
  name: "agent.yaml",
  kind: ExecutionArtifactKind.FILE,
  sizeBytes: 512n,
  sandboxPath: ".stigmer/agent.yaml",
  storageKey: "artifacts/aex_1/agent.yaml",
});

const artifactExecution = create(AgentExecutionSchema, {
  metadata: { id: "aex_1" },
  status: {
    phase: ExecutionPhase.EXECUTION_COMPLETED,
    artifacts: [artifact],
  },
});

const entry: SessionArtifactEntry = {
  artifact,
  executionId: "aex_1",
  isTerminal: true,
  hasNameCollision: false,
};

const stubWorkspace = {
  entries: [],
  hasEntries: false,
  toInput: vi.fn().mockReturnValue([]),
  addGitRepo: vi.fn(),
  addLocalPath: vi.fn(),
  remove: vi.fn(),
  clear: vi.fn(),
  clearLocal: vi.fn(),
};

const stubConv = {
  session: { spec: {} },
  isLoading: false,
  loadError: null,
  completedExecutions: [artifactExecution],
  activeStreamExecution: null,
  pendingUserMessage: null,
  workspaceEntries: [],
  fileChangeSets: [],
  submitFileDecision: vi.fn(),
  submittingFileDecisionKeys: new Set<string>(),
  fileDecisionErrors: new Map<string, Error>(),
  sendError: null,
  stopError: null,
  streamError: null,
  reconnectStream: vi.fn(),
  submittingApprovalIds: new Set<string>(),
  approvalErrors: new Map<string, Error>(),
  isStoppable: false,
  isStopping: false,
  isSending: false,
  canSendFollowUp: true,
  isReconnecting: false,
  connectTimedOut: false,
  isSlow: false,
  stop: vi.fn(),
  retryLastSend: vi.fn(),
};

const stubSessionPageFlow = {
  conv: stubConv,
  harness: "native" as const,
  executionTarget: undefined,
  model: [undefined, vi.fn()] as const,
  interactionMode: ["agent" as const, vi.fn()] as const,
  agentRef: { org: "acme", slug: "support-bot" },
  setAgentRef: vi.fn(),
  resolution: null,
  setResolution: vi.fn(),
  isDefaultAgent: false,
  mcpServerUsages: [],
  setMcpServerUsages: vi.fn(),
  skillRefs: [],
  setSkillRefs: vi.fn(),
  workspace: stubWorkspace,
  sessionVariables: { entries: [], isEmpty: true, clear: vi.fn() },
  autoApproveAll: false,
  setAutoApproveAll: vi.fn(),
  handleSubmit: vi.fn(),
  submitError: null as Error | null,
  displayExecution: artifactExecution,
  allExecutions: [artifactExecution],
  sandboxWorkspaceRoot: "/home/daytona/workspace",
};
vi.mock("../useSessionPageFlow", () => ({
  useSessionPageFlow: () => stubSessionPageFlow,
}));

vi.mock("../../hooks", () => ({
  useStigmer: () => ({
    agentExecution: {
      uploadAttachment: vi.fn(),
      getArtifactContent: vi.fn(),
    },
  }),
}));

import { SessionViewer } from "../SessionViewer";

/** The latest editors array the (mocked) WorkspaceSurface received. */
function latestEditors(): ReadonlyArray<{
  entryId: string;
  path: string;
  preview: boolean;
}> {
  return (surfaceProps.at(-1)?.editors ?? []) as never;
}

/** Read a callback off the rail-view <ArtifactsTab> element the surface received. */
function artifactsTabCallback(
  name: "onOpenArtifact" | "onActivateArtifact",
): (entry: SessionArtifactEntry) => void {
  const views = surfaceProps.at(-1)?.extraViews as
    | ReadonlyArray<{ id: string; content: { props: CapturedProps } }>
    | undefined;
  const artifactsView = views?.find((v) => v.id === "artifacts");
  if (!artifactsView) throw new Error("Artifacts rail view not present");
  return artifactsView.content.props[name] as (e: SessionArtifactEntry) => void;
}

beforeEach(() => {
  threadProps.length = 0;
  surfaceProps.length = 0;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SessionViewer — Artifacts facet open/pin wiring", () => {
  it("threads onOpenArtifact + onActivateArtifact into the Artifacts rail view", () => {
    render(<SessionViewer sessionId="ses_1" org="acme" />);
    fireEvent.click(screen.getByRole("button", { name: "Show panel" }));

    expect(typeof artifactsTabCallback("onOpenArtifact")).toBe("function");
    expect(typeof artifactsTabCallback("onActivateArtifact")).toBe("function");
  });

  it("opening an artifact lands a PREVIEW tab; activating it pins the tab", () => {
    render(<SessionViewer sessionId="ses_1" org="acme" />);
    fireEvent.click(screen.getByRole("button", { name: "Show panel" }));

    // Single-click preview → one preview tab keyed by the artifact identity.
    act(() => artifactsTabCallback("onOpenArtifact")(entry));
    expect(latestEditors()).toEqual([
      { entryId: ARTIFACT_DOCUMENT_ENTRY_ID, path: artifactKey(artifact), preview: true },
    ]);

    // Double-click pin → the same tab, now persistent.
    act(() => artifactsTabCallback("onActivateArtifact")(entry));
    expect(latestEditors()).toEqual([
      { entryId: ARTIFACT_DOCUMENT_ENTRY_ID, path: artifactKey(artifact), preview: false },
    ]);
  });
});
