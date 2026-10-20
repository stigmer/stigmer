import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent, waitFor } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { FileSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { FILE_DOCUMENT_ENTRY_ID } from "../../run/file-document";
import { outputKey, type SessionOutputEntry } from "../useSessionOutputs";

// ---------------------------------------------------------------------------
// Wiring-contract test for the Artifacts facet's open/pin gestures. The
// `onOpenArtifact` (single-click preview) and `onActivateArtifact` (double-click
// pin) callbacks must thread from SessionViewer, through the intermediate
// SessionPanelRegion, into useSessionRailViews' <FilesTab>, and — when
// invoked — land as an artifact virtual-document tab on the editors store.
// WorkspaceSurface renders as a prop-capturing probe; the store + panel-region
// wire between them is the subject under test. Tab MECHANICS (preview-slot
// reuse, pin promotion) live in workspace-editors-store.test.ts and are not
// re-tested here.
// ---------------------------------------------------------------------------

type CapturedProps = Record<string, unknown>;

const threadProps: CapturedProps[] = [];
vi.mock("../../run/MessageThread", () => ({
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

// What the turn returned: a File it saved in its outputs folder.
const artifact = create(FileSchema, {
  metadata: { id: "file_agent" },
  spec: { filename: "agent.yaml" },
  status: { sizeBytes: 512n, sessionId: "ses_1", runId: "aex_1", outputPath: "configs/agent.yaml" },
});

// A person's upload: a File of the conversation that no turn returned.
const upload = create(FileSchema, {
  metadata: { id: "file_brief" },
  spec: { filename: "brief.pdf" },
  status: { sizeBytes: 64n, sessionId: "ses_1" },
});

const artifactExecution = create(RunSchema, {
  metadata: { id: "aex_1" },
  status: { phase: RunPhase.RUN_COMPLETED },
});

const entry: SessionOutputEntry = {
  file: artifact,
  runId: "aex_1",
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
  org: "acme",
  session: { spec: {} },
  isLoading: false,
  loadError: null,
  turns: [],
  runs: [artifactExecution],
  activeTurn: null,
  activeRun: null,
  pendingUserMessage: null,
  resources: [],
  fileReviewSets: [],
  fileChangeCaptures: new Map(),
  reviewFileChanges: vi.fn(),
  submittingFileDecisionKeys: new Set<string>(),
  fileDecisionErrors: new Map<string, Error>(),
  sendError: null,
  stopError: null,
  streamError: null,
  reconnectStream: vi.fn(),
  answeringToolUseIds: new Set<string>(),
  answerErrors: new Map<string, Error>(),
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
  agentVersion: {
    pinnedHash: "",
    currentHash: "",
    agentName: "",
    isOutdated: false,
    labelOf: (hash: string) => hash.slice(0, 12),
    update: vi.fn(),
    isUpdating: false,
    updateError: null,
  },
  pluginRefs: [],
  setPluginRefs: vi.fn(),
  skillRefs: [],
  setSkillRefs: vi.fn(),
  workspace: stubWorkspace,
  sessionVariables: { entries: [], isEmpty: true, clear: vi.fn(), nextPageToken: "" },
  autoApproveAll: false,
  setAutoApproveAll: vi.fn(),
  handleSubmit: vi.fn(),
  submitError: null as Error | null,
  displayRun: artifactExecution,
  allRuns: [artifactExecution],
  sandboxWorkspaceRoot: "/home/daytona/workspace",
};
vi.mock("../useSessionPageFlow", () => ({
  useSessionPageFlow: () => stubSessionPageFlow,
}));

// The reader's own access to the conversation: an owner's, unless a case
// says otherwise.
vi.mock("../useSessionAccess", () => ({
  useSessionAccess: () => ({ canSend: true, canDecide: true }),
}));

// One client for every render, as the provider gives: a new object per call
// would re-read the conversation's Files on every render.
const client = vi.hoisted(() => ({
  // Server info answers the Environment row: a server that predates the field.
  platform: { getServerInfo: async () => ({}) },
  file: { listAll: vi.fn(), getContent: vi.fn() },
}));
const listAll = client.file.listAll;

vi.mock("../../hooks", () => ({
  useStigmer: () => client,
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

/** The props of the rail-view <FilesTab> element the surface received. */
function artifactsTabProps(): CapturedProps {
  const views = surfaceProps.at(-1)?.extraViews as
    | ReadonlyArray<{ id: string; content: { props: CapturedProps } }>
    | undefined;
  const artifactsView = views?.find((v) => v.id === "artifacts");
  if (!artifactsView) throw new Error("Artifacts rail view not present");
  return artifactsView.content.props;
}

/** Read a callback off the rail-view <FilesTab> element the surface received. */
function artifactsTabCallback(
  name: "onOpenArtifact" | "onActivateArtifact",
): (entry: SessionOutputEntry) => void {
  return artifactsTabProps()[name] as (e: SessionOutputEntry) => void;
}

/** Shows the panel once the conversation's Files are listed. */
async function showPanelWithArtifacts() {
  fireEvent.click(screen.getByRole("button", { name: "Show panel" }));
  await waitFor(() => expect(() => artifactsTabProps()).not.toThrow());
}

beforeEach(() => {
  threadProps.length = 0;
  surfaceProps.length = 0;
  listAll.mockImplementation(async function* () {
    yield* [upload, artifact];
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SessionViewer — Artifacts facet open/pin wiring", () => {
  it("threads onOpenArtifact + onActivateArtifact into the Artifacts rail view", async () => {
    render(<SessionViewer sessionId="ses_1" org="acme" />);
    await showPanelWithArtifacts();

    expect(typeof artifactsTabCallback("onOpenArtifact")).toBe("function");
    expect(typeof artifactsTabCallback("onActivateArtifact")).toBe("function");
  });

  it("opening an artifact lands a PREVIEW tab; activating it pins the tab", async () => {
    render(<SessionViewer sessionId="ses_1" org="acme" />);
    await showPanelWithArtifacts();

    // Single-click preview → one preview tab keyed by the artifact identity.
    act(() => artifactsTabCallback("onOpenArtifact")(entry));
    expect(latestEditors()).toEqual([
      { entryId: FILE_DOCUMENT_ENTRY_ID, path: outputKey(artifact), preview: true },
    ]);

    // Double-click pin → the same tab, now persistent.
    act(() => artifactsTabCallback("onActivateArtifact")(entry));
    expect(latestEditors()).toEqual([
      { entryId: FILE_DOCUMENT_ENTRY_ID, path: outputKey(artifact), preview: false },
    ]);
  });
});

describe("SessionViewer — the Artifacts facet lists the conversation's output Files", () => {
  it("lists the Files a turn returned, by output path, and leaves a person's uploads out", async () => {
    render(<SessionViewer sessionId="ses_1" org="acme" />);
    await showPanelWithArtifacts();

    expect(listAll.mock.calls[0]![0]).toEqual({ org: "acme", sessionId: "ses_1" });
    const entries = artifactsTabProps().artifacts as readonly SessionOutputEntry[];
    expect(entries.map((e) => e.file.metadata?.id)).toEqual(["file_agent"]);
    expect(outputKey(entries[0]!.file)).toBe("configs/agent.yaml");
  });

  it("re-reads the conversation's Files when the facet opens", async () => {
    render(<SessionViewer sessionId="ses_1" org="acme" />);
    await showPanelWithArtifacts();
    const reads = listAll.mock.calls.length;

    act(() => (artifactsTabProps().onShown as () => void)());

    await waitFor(() => expect(listAll.mock.calls.length).toBe(reads + 1));
  });
});
