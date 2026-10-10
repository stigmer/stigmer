// ---------------------------------------------------------------------------
// The plan handoff between the thread and the session's plan document:
//
// - "Open plan" on a turn picks which plan the plan tab shows: an earlier
//   turn's plan opens read-only, the latest plan (or a turn with no plan)
//   opens the editable current plan.
// - "Build from plan" reads the published plan by its run and storage key,
//   uploads it as the approved copy, and submits the build turn with it
//   mounted as an input; a truncated read never attaches a partial plan, the
//   turn goes on without it and the viewer says so.
//
// The thread, the composer and the workspace surface are prop-capturing
// probes; the composer probe exposes the imperative `submit` handle.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent, waitFor } from "@testing-library/react";
import { useImperativeHandle, type ReactElement, type Ref } from "react";
import { create } from "@bufbuild/protobuf";
import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunArtifactSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/artifact_pb";
import {
  RunArtifactKind,
  RunPhase,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import type { SessionComposerHandle } from "../../composer";
import type { SessionPlan } from "../../library/detect-plan-artifact";
import { PLAN_DOCUMENT_ENTRY_ID } from "../plan-document";

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
  run: {
    uploadAttachment: vi.fn(),
    getArtifactContent: vi.fn(),
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

function planArtifact(runId: string) {
  return create(RunArtifactSchema, {
    name: "plan.md",
    kind: RunArtifactKind.FILE,
    sizeBytes: 64n,
    sandboxPath: ".stigmer/plan.md",
    storageKey: `artifacts/${runId}/plan.md`,
    contentHash: `hash-${runId}`,
  });
}

function completedRun(id: string, withPlan: boolean) {
  return create(RunSchema, {
    metadata: { id },
    status: {
      phase: RunPhase.RUN_COMPLETED,
      artifacts: withPlan ? [planArtifact(id)] : [],
    },
  });
}

const earlierPlanRun = completedRun("aex_early", true);
const chatRun = completedRun("aex_chat", false);
const latestPlanRun = completedRun("aex_latest", true);
const runs = [earlierPlanRun, chatRun, latestPlanRun];

const stubConv = {
  org: "acme",
  session: { spec: {} },
  isLoading: false,
  loadError: null,
  completedRuns: runs,
  activeStreamRun: null,
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
  mcpServerUsages: [],
  setMcpServerUsages: vi.fn(),
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
  sessionVariables: { entries: [], isEmpty: true, clear: vi.fn() },
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

function lastThread(): CapturedProps {
  expect(threadProps.length).toBeGreaterThan(0);
  return threadProps.at(-1)!;
}

/** The plan the plan document tab renders, read off the surface's virtual document. */
function planTabEditor(): { plan: SessionPlan; readOnly: boolean } {
  const docs = surfaceProps.at(-1)?.virtualDocuments as
    | ReadonlyArray<{ entryId: string; content: ReactElement<{ plan: SessionPlan; readOnly: boolean }> }>
    | undefined;
  const planDoc = docs?.find((d) => d.entryId === PLAN_DOCUMENT_ENTRY_ID);
  if (!planDoc) throw new Error("plan document not present");
  return planDoc.content.props;
}

beforeEach(() => {
  threadProps.length = 0;
  surfaceProps.length = 0;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SessionViewer — Open plan picks the plan tab's plan", () => {
  it("opens an earlier turn's plan read-only and the latest plan editable", () => {
    render(<SessionViewer sessionId="ses_1" org="acme" />);
    fireEvent.click(screen.getByRole("button", { name: "Show panel" }));

    const onOpenPlan = lastThread().onOpenPlan as (runId: string) => void;
    act(() => onOpenPlan("aex_early"));
    expect(planTabEditor().plan.runId).toBe("aex_early");
    expect(planTabEditor().readOnly).toBe(true);

    act(() => (lastThread().onOpenPlan as (runId: string) => void)("aex_latest"));
    expect(planTabEditor().plan.runId).toBe("aex_latest");
    expect(planTabEditor().readOnly).toBe(false);
  });

  it("falls back to the latest plan for a turn that published none", () => {
    render(<SessionViewer sessionId="ses_1" org="acme" />);
    fireEvent.click(screen.getByRole("button", { name: "Show panel" }));

    act(() => (lastThread().onOpenPlan as (runId: string) => void)("aex_chat"));
    expect(planTabEditor().plan.runId).toBe("aex_latest");
    expect(planTabEditor().readOnly).toBe(false);
  });
});

describe("SessionViewer — Build from plan attaches the approved plan", () => {
  it("reads the latest plan, uploads it, and submits the build turn with it mounted", async () => {
    client.run.getArtifactContent.mockResolvedValue({
      content: new TextEncoder().encode("# Plan\n\n1. Do it\n"),
      contentType: "text/markdown",
      truncated: false,
    });
    client.run.uploadAttachment.mockResolvedValue({ storageKey: "uploads/approved-plan.md" });
    render(<SessionViewer sessionId="ses_1" org="acme" />);

    act(() => (lastThread().onBuildFromPlan as () => void)());

    await waitFor(() => expect(composerSubmit).toHaveBeenCalledOnce());
    expect(client.run.getArtifactContent.mock.calls[0]![0]).toMatchObject({
      runId: "aex_latest",
      storageKey: "artifacts/aex_latest/plan.md",
    });
    const upload = client.run.uploadAttachment.mock.calls[0]![0] as {
      filename: string;
      content: Uint8Array;
      contentType: string;
    };
    expect(upload.filename).toBe("plan.md");
    expect(upload.contentType).toBe("text/markdown");
    expect(new TextDecoder().decode(upload.content)).toBe("# Plan\n\n1. Do it\n");
    expect(composerSubmit).toHaveBeenCalledWith("Build from plan", {
      interactionMode: "agent",
      buildFromPlan: true,
      attachments: [
        {
          filename: "plan.md",
          storageKey: "uploads/approved-plan.md",
          mountPath: ".stigmer/inputs/plan.md",
          contentType: "text/markdown",
        },
      ],
    });
  });

  it("builds without an attachment and says so when the plan read is truncated", async () => {
    client.run.getArtifactContent.mockResolvedValue({
      content: new Uint8Array(),
      contentType: "text/markdown",
      truncated: true,
    });
    render(<SessionViewer sessionId="ses_1" org="acme" />);

    act(() => (lastThread().onBuildFromPlan as () => void)());

    await waitFor(() => expect(composerSubmit).toHaveBeenCalledOnce());
    expect(client.run.uploadAttachment).not.toHaveBeenCalled();
    expect(composerSubmit).toHaveBeenCalledWith("Build from plan", {
      interactionMode: "agent",
      buildFromPlan: true,
      attachments: undefined,
    });
    await screen.findByText(/attach plan\.md/);
  });
});
