// ---------------------------------------------------------------------------
// The plan handoff between the thread and the session's plan document:
//
// - A plan the live Plan-mode turn is writing shows in the plan tab as it
//   streams.
// - "Open plan" on a turn picks which plan the plan tab shows: an earlier
//   turn's plan opens read-only, the latest plan (or a turn with no plan)
//   opens the editable current plan.
// - "Build from plan" on an unedited plan names the plan File the turn
//   returned on the build turn, with no read and no second upload; an edited
//   plan is uploaded as one new File of the conversation and named instead;
//   an upload that answers no File builds without it and the viewer says so.
//
// The thread, the composer and the workspace surface are prop-capturing
// probes; the composer probe exposes the imperative `submit` handle.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent, waitFor } from "@testing-library/react";
import { useImperativeHandle, type ReactElement, type Ref } from "react";
import { create } from "@bufbuild/protobuf";
import { RunSchema, type Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { FileSchema, type File as StigmerFile } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { InteractionMode, RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type { Turn } from "@stigmer/client";
import { samples } from "../../test/samples";
import type { SessionComposerHandle } from "../../composer";
import type { SessionPlan } from "../../library/detect-plan-file";
import type { PlanDraftController } from "../usePlanDraft";
import { PLAN_DOCUMENT_ENTRY_ID } from "../plan-document";

type CapturedProps = Record<string, unknown>;

const previews: { file: { status?: { runId?: string } }; open: boolean; onClose: () => void }[] = [];
vi.mock("../../run/FilePreviewModal", () => ({
  FilePreviewModal: (props: { file: { status?: { runId?: string } }; open: boolean; onClose: () => void }) => {
    previews.push(props);
    return null;
  },
}));

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

const composerSubmit = vi.fn();
vi.mock("../../composer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../composer")>();
  return {
    ...actual,
    SessionComposer: ({ ref }: { ref?: Ref<SessionComposerHandle> }) => {
      useImperativeHandle(ref, () => ({
        submit: composerSubmit,
        setMessage: vi.fn(),
        focus: vi.fn(),
      }) as unknown as SessionComposerHandle);
      return <div data-testid="composer-probe" />;
    },
  };
});

const client = vi.hoisted(() => ({
  // Server info answers the Environment row: a server that predates the field.
  platform: { getServerInfo: async () => ({}) },
  file: {
    uploadFile: vi.fn(),
    getContent: vi.fn(),
    listAll: vi.fn(),
  },
}));
// The reader's own access to the conversation: an owner's, unless a case
// says otherwise.
vi.mock("../useSessionAccess", () => ({
  useSessionAccess: () => ({ canSend: true, canDecide: true }),
}));

vi.mock("../../hooks", () => ({
  useStigmer: () => client,
}));

function planFile(runId: string): StigmerFile {
  return create(FileSchema, {
    metadata: { id: `file_plan_${runId}` },
    spec: { filename: "rollout_1a2b3c4d.plan.md", mimeType: "text/markdown" },
    status: { sizeBytes: 64n, sessionId: "ses_1", runId, outputPath: "rollout_1a2b3c4d.plan.md" },
  });
}

function completedRun(id: string, mode: InteractionMode) {
  return create(RunSchema, {
    metadata: { id },
    spec: { interactionMode: mode },
    status: { phase: RunPhase.RUN_COMPLETED },
  });
}

const earlierPlanRun = completedRun("run_early", InteractionMode.PLAN);
const chatRun = completedRun("run_chat", InteractionMode.AGENT);
const latestPlanRun = completedRun("run_latest", InteractionMode.PLAN);
const runs = [earlierPlanRun, chatRun, latestPlanRun];
// The conversation's Files, newest first: each Plan-mode turn's plan File.
const sessionFiles = [planFile("run_latest"), planFile("run_early")];

const stubConv = {
  org: "acme",
  session: { spec: {} },
  isLoading: false,
  loadError: null,
  turns: [],
  runs: runs,
  activeTurn: null as Turn | null,
  activeRun: null as Run | null,
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
  liveness: undefined,
  stop: vi.fn(),
  retryLastSend: vi.fn(),
};

const stubSessionPageFlow = {
  conv: stubConv,
  harness: "stigmer" as const,
  executionTarget: undefined,
  model: [undefined, vi.fn()] as const,
  interactionMode: ["plan" as const, vi.fn()] as const,
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
  workspace: {
    entries: [],
    hasEntries: false,
    toInput: vi.fn().mockReturnValue([]),
    addGitRepo: vi.fn(),
    addLocalPath: vi.fn(),
    remove: vi.fn(),
    clear: vi.fn(),
    clearLocal: vi.fn(),
  },
  sessionVariables: { entries: [], isEmpty: true, clear: vi.fn(), nextPageToken: "" },
  autoApproveAll: false,
  setAutoApproveAll: vi.fn(),
  handleSubmit: vi.fn(),
  submitError: null as Error | null,
  displayRun: latestPlanRun,
  allRuns: runs,
  sandboxWorkspaceRoot: "/home/daytona/workspace",
};
vi.mock("../useSessionPageFlow", () => ({
  useSessionPageFlow: () => stubSessionPageFlow,
}));

import { SessionViewer } from "../SessionViewer";
import { SessionInspector } from "../inspector/SessionInspector";

function lastThread(): CapturedProps {
  expect(threadProps.length).toBeGreaterThan(0);
  return threadProps.at(-1)!;
}

interface PlanEditorProbe {
  plan: SessionPlan;
  readOnly: boolean;
  draft?: PlanDraftController;
}

/** The plan the plan document tab renders, read off the surface's virtual document. */
function planTabEditor(): PlanEditorProbe {
  const docs = surfaceProps.at(-1)?.virtualDocuments as
    | ReadonlyArray<{ entryId: string; content: ReactElement<PlanEditorProbe> }>
    | undefined;
  const planDoc = docs?.find((d) => d.entryId === PLAN_DOCUMENT_ENTRY_ID);
  if (!planDoc) throw new Error("plan document not present");
  return planDoc.content.props;
}

/** Waits until the conversation's Files have been listed and the plans found. */
async function plansLoaded() {
  await waitFor(() =>
    expect((lastThread().planFiles as ReadonlyMap<string, StigmerFile> | undefined)?.size).toBe(2),
  );
}

beforeEach(() => {
  threadProps.length = 0;
  surfaceProps.length = 0;
  client.file.listAll.mockImplementation(async function* () {
    yield* sessionFiles;
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  stubConv.activeTurn = null;
  stubConv.activeRun = null;
});

describe("SessionViewer — a plan being written", () => {
  it("renders the live turn's plan in the plan tab as it streams", () => {
    stubConv.activeTurn = samples.turn({
      runId: "run_live",
      reply: "# Live plan\n\n1. First step",
      phase: "running",
    });
    stubConv.activeRun = create(RunSchema, {
      metadata: { id: "run_live" },
      spec: { interactionMode: InteractionMode.PLAN },
    });
    render(<SessionViewer sessionId="ses_1" org="acme" inspector={<SessionInspector />} />);
    fireEvent.click(screen.getByRole("button", { name: "Show panel" }));

    const docs = surfaceProps.at(-1)?.virtualDocuments as
      | ReadonlyArray<{ entryId: string; content: ReactElement<{ displayText: string }> }>
      | undefined;
    const planDoc = docs?.find((d) => d.entryId === PLAN_DOCUMENT_ENTRY_ID);
    expect(planDoc?.content.props.displayText).toBe("# Live plan\n\n1. First step");
  });
});

describe("SessionViewer — an old plan on load", () => {
  it("leaves the panel closed when the session's plan arrives with the first Files read", async () => {
    render(<SessionViewer sessionId="ses_1" org="acme" inspector={<SessionInspector />} />);
    await plansLoaded();
    // Let the panel's effects settle before reading its state.
    await act(async () => {});

    expect(screen.getByRole("button", { name: "Show panel" })).toBeTruthy();
  });
});

describe("SessionViewer — Open plan picks the plan tab's plan", () => {
  it("opens an earlier turn's plan read-only and the latest plan editable", async () => {
    render(<SessionViewer sessionId="ses_1" org="acme" inspector={<SessionInspector />} />);
    await plansLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Show panel" }));

    const onOpenPlan = lastThread().onOpenPlan as (runId: string) => void;
    act(() => onOpenPlan("run_early"));
    expect(planTabEditor().plan.runId).toBe("run_early");
    expect(planTabEditor().readOnly).toBe(true);

    act(() => (lastThread().onOpenPlan as (runId: string) => void)("run_latest"));
    expect(planTabEditor().plan.runId).toBe("run_latest");
    expect(planTabEditor().readOnly).toBe(false);
  });

  it("falls back to the latest plan for a turn that published none", async () => {
    render(<SessionViewer sessionId="ses_1" org="acme" inspector={<SessionInspector />} />);
    await plansLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Show panel" }));

    act(() => (lastThread().onOpenPlan as (runId: string) => void)("run_chat"));
    expect(planTabEditor().plan.runId).toBe("run_latest");
    expect(planTabEditor().readOnly).toBe(false);
  });
});

describe("SessionViewer — Open plan with no inspector", () => {
  it("shows the turn's plan File, else the latest, read-only in the File preview, and closes it", async () => {
    render(<SessionViewer sessionId="ses_1" org="acme" />);
    await plansLoaded();

    act(() => (lastThread().onOpenPlan as (runId: string) => void)("run_early"));
    expect(previews.at(-1)).toMatchObject({ open: true, file: { status: { runId: "run_early" } } });

    act(() => (lastThread().onOpenPlan as (runId: string) => void)("run_chat"));
    expect(previews.at(-1)).toMatchObject({ open: true, file: { status: { runId: "run_latest" } } });

    act(() => previews.at(-1)!.onClose());
    expect(previews.at(-1)!.open).toBe(false);
  });
});

describe("SessionViewer — Build from plan hands the build turn the plan", () => {
  it("names the unedited plan File on the build turn, with no read and no upload", async () => {
    render(<SessionViewer sessionId="ses_1" org="acme" inspector={<SessionInspector />} />);
    await plansLoaded();

    act(() => (lastThread().onBuildFromPlan as () => void)());

    await waitFor(() => expect(composerSubmit).toHaveBeenCalledOnce());
    expect(client.file.uploadFile).not.toHaveBeenCalled();
    expect(client.file.getContent).not.toHaveBeenCalled();
    expect(composerSubmit).toHaveBeenCalledWith("Build from plan", {
      interactionMode: "agent",
      buildFromPlan: true,
      fileIds: ["file_plan_run_latest"],
    });
  });

  it("uploads an edited plan as one File of the conversation and names it", async () => {
    client.file.uploadFile.mockResolvedValue({ metadata: { id: "file_edited" }, status: { sessionId: "ses_1" } });
    render(<SessionViewer sessionId="ses_1" org="acme" inspector={<SessionInspector />} />);
    await plansLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Show panel" }));
    act(() => planTabEditor().draft!.setDraft("# Plan\n\n1. Do it, edited\n"));

    act(() => (lastThread().onBuildFromPlan as () => void)());

    await waitFor(() => expect(composerSubmit).toHaveBeenCalledOnce());
    expect(client.file.uploadFile).toHaveBeenCalledOnce();
    const upload = client.file.uploadFile.mock.calls[0]![0] as {
      sessionId: string;
      filename: string;
      content: Uint8Array;
      mimeType: string;
    };
    expect(upload.sessionId).toBe("ses_1");
    expect(upload.filename).toBe("rollout_1a2b3c4d.plan.md");
    expect(upload.mimeType).toBe("text/markdown");
    expect(new TextDecoder().decode(upload.content)).toBe("# Plan\n\n1. Do it, edited\n");
    expect(composerSubmit).toHaveBeenCalledWith("Build from plan", {
      interactionMode: "agent",
      buildFromPlan: true,
      fileIds: ["file_edited"],
    });
  });

  it("builds without the plan and says so when the upload answers no File", async () => {
    client.file.uploadFile.mockResolvedValue({ metadata: undefined, status: undefined });
    render(<SessionViewer sessionId="ses_1" org="acme" inspector={<SessionInspector />} />);
    await plansLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Show panel" }));
    act(() => planTabEditor().draft!.setDraft("# Plan, edited\n"));

    act(() => (lastThread().onBuildFromPlan as () => void)());

    await waitFor(() => expect(composerSubmit).toHaveBeenCalledOnce());
    expect(composerSubmit).toHaveBeenCalledWith("Build from plan", {
      interactionMode: "agent",
      buildFromPlan: true,
      fileIds: undefined,
    });
    await screen.findByText(/attach plan\.md/);
  });
});
