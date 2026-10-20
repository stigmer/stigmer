import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent, waitFor } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { FileSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { FILE_DOCUMENT_ENTRY_ID } from "../../run/file-document";
import { outputKey, type SessionOutputEntry } from "../useSessionOutputs";
import { givenKey, type SessionGivenEntry } from "../useSessionGivenFiles";
import { CONVERSATION_FILES_VIEW_ID } from "../useSessionRailViews";

// ---------------------------------------------------------------------------
// Wiring-contract test for the Files facet. The conversation's Files reach
// the facet in two groups (what the agent saved, what was given, each given
// File at the place the conversation's resources settle); the list re-reads
// when a turn starts as well as when it ends; and the open/pin gestures
// (`onOpenFileDocument`, `onActivateFileDocument`, by document key) thread
// from SessionViewer, through SessionPanelRegion, into useSessionRailViews'
// <FilesTab>, landing as File virtual-document tabs on the editors store.
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
  // The upload was given with a message; the server settled its place.
  resources: [{ name: "", resource: { case: "file", value: { fileId: "file_brief", mountPath: "briefs/brief.pdf" } } }],
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
  allRuns: [artifactExecution] as ReturnType<typeof create<typeof RunSchema>>[],
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
function filesTabProps(): CapturedProps {
  const views = surfaceProps.at(-1)?.extraViews as
    | ReadonlyArray<{ id: string; content: { props: CapturedProps } }>
    | undefined;
  const filesView = views?.find((v) => v.id === CONVERSATION_FILES_VIEW_ID);
  if (!filesView) throw new Error("Files rail view not present");
  return filesView.content.props;
}

/** Read a document callback off the rail-view <FilesTab> element the surface received. */
function filesTabCallback(
  name: "onOpenFileDocument" | "onActivateFileDocument",
): (documentKey: string) => void {
  return filesTabProps()[name] as (documentKey: string) => void;
}

/** Shows the panel once the conversation's Files are listed. */
async function showPanelWithFiles() {
  fireEvent.click(screen.getByRole("button", { name: "Show panel" }));
  await waitFor(() => expect(() => filesTabProps()).not.toThrow());
}

beforeEach(() => {
  threadProps.length = 0;
  surfaceProps.length = 0;
  stubSessionPageFlow.allRuns = [artifactExecution];
  listAll.mockImplementation(async function* () {
    yield* [upload, artifact];
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SessionViewer — Files facet open/pin wiring", () => {
  it("threads onOpenFileDocument + onActivateFileDocument into the Files rail view", async () => {
    render(<SessionViewer sessionId="ses_1" org="acme" />);
    await showPanelWithFiles();

    expect(typeof filesTabCallback("onOpenFileDocument")).toBe("function");
    expect(typeof filesTabCallback("onActivateFileDocument")).toBe("function");
  });

  it("opening a saved File lands a PREVIEW tab; activating it pins the tab", async () => {
    render(<SessionViewer sessionId="ses_1" org="acme" />);
    await showPanelWithFiles();

    // Single-click preview → one preview tab keyed by the output's identity.
    act(() => filesTabCallback("onOpenFileDocument")(outputKey(artifact)));
    expect(latestEditors()).toEqual([
      { entryId: FILE_DOCUMENT_ENTRY_ID, path: outputKey(artifact), preview: true },
    ]);

    // Double-click pin → the same tab, now persistent.
    act(() => filesTabCallback("onActivateFileDocument")(outputKey(artifact)));
    expect(latestEditors()).toEqual([
      { entryId: FILE_DOCUMENT_ENTRY_ID, path: outputKey(artifact), preview: false },
    ]);
  });

  it("opens a given File's tab at its place under the uploads folder, with a document for it", async () => {
    render(<SessionViewer sessionId="ses_1" org="acme" />);
    await showPanelWithFiles();
    const given = (filesTabProps().given as readonly SessionGivenEntry[])[0]!;

    act(() => filesTabCallback("onOpenFileDocument")(givenKey(given)));

    expect(latestEditors()).toEqual([
      { entryId: FILE_DOCUMENT_ENTRY_ID, path: ".stigmer/uploads/briefs/brief.pdf", preview: true },
    ]);
    const documents = surfaceProps.at(-1)?.virtualDocuments as ReadonlyArray<{
      path: string;
      content: { props: CapturedProps };
    }>;
    const document = documents.find((d) => d.path === ".stigmer/uploads/briefs/brief.pdf");
    expect((document?.content.props.file as typeof upload | undefined)?.metadata?.id).toBe("file_brief");
  });
});

describe("SessionViewer — the Files facet lists what was saved and what was given", () => {
  it("lists a turn's Files by output path, and a person's upload at the place the conversation gave it", async () => {
    render(<SessionViewer sessionId="ses_1" org="acme" />);
    await showPanelWithFiles();

    expect(listAll.mock.calls[0]![0]).toEqual({ org: "acme", sessionId: "ses_1" });
    const outputs = filesTabProps().outputs as readonly SessionOutputEntry[];
    expect(outputs.map((e) => e.file.metadata?.id)).toEqual(["file_agent"]);
    expect(outputKey(outputs[0]!.file)).toBe("configs/agent.yaml");
    const given = filesTabProps().given as readonly SessionGivenEntry[];
    expect(given.map((e) => [e.file.metadata?.id, e.place])).toEqual([["file_brief", "briefs/brief.pdf"]]);
  });

  it("re-reads the conversation's Files when the facet opens", async () => {
    render(<SessionViewer sessionId="ses_1" org="acme" />);
    await showPanelWithFiles();
    const reads = listAll.mock.calls.length;

    act(() => (filesTabProps().onShown as () => void)());

    await waitFor(() => expect(listAll.mock.calls.length).toBe(reads + 1));
  });

  it("re-reads the conversation's Files when a turn starts, before it ends", async () => {
    const { rerender } = render(<SessionViewer sessionId="ses_1" org="acme" />);
    await showPanelWithFiles();
    const reads = listAll.mock.calls.length;

    // A follow-up's turn starts: the Files sent with its message are the
    // conversation's from this moment, and the turn has not ended.
    stubSessionPageFlow.allRuns = [
      artifactExecution,
      create(RunSchema, { metadata: { id: "aex_2" }, status: { phase: RunPhase.RUN_IN_PROGRESS } }),
    ];
    rerender(<SessionViewer sessionId="ses_1" org="acme" />);

    await waitFor(() => expect(listAll.mock.calls.length).toBe(reads + 1));
  });
});
