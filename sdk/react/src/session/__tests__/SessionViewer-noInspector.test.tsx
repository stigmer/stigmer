/**
 * Proves the session viewer without the host's inspector, as an embed draws
 * it. The workspace surface (the explorer, editor and facets) cannot even be
 * imported here: its module throws, so this file loads only because nothing
 * the viewer imports pulls the inspector's code in, the seam the light chat
 * entry packages. An end user and a guest see no builder controls: no panel
 * chip, no engine, target or Environment in the run settings (a guest has
 * none at all). And everything a turn produced still opens from the
 * conversation itself: a File it returned in the File preview, a change the
 * run captured as its diff, from the turn's outcome (a path in the thread:
 * SessionViewer-transcriptFileOpen.test.tsx). The composer is a prop-capturing probe; the thread is real, over
 * the scenario catalogue's finished conversation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, cleanup, fireEvent } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { RunStatusSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { FileChangeKind } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { CapturedFileChangeSchema, FileChangeSetSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/filereview_pb";
import type { File as StigmerFile } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import type { DisplayFileChange } from "@stigmer/client";
import { conversationOf, samples, scenarios } from "../../test";

vi.mock("../../workspace/WorkspaceSurface", () => {
  throw new Error("the inspector's workspace surface was imported by a viewer with no inspector");
});

type CapturedProps = Record<string, unknown>;

const composerProps: CapturedProps[] = [];
vi.mock("../../composer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../composer")>();
  return {
    ...actual,
    SessionComposer: (props: CapturedProps) => {
      composerProps.push(props);
      return <div data-testid="composer-probe" />;
    },
  };
});

type PreviewProps = { file: StigmerFile; open: boolean; onClose: () => void; readOnly?: boolean; onApplied?: unknown };
const previews: PreviewProps[] = [];
vi.mock("../../run/FilePreviewModal", () => ({
  FilePreviewModal: (props: PreviewProps) => {
    previews.push(props);
    return null;
  },
}));

const dialogs: (DisplayFileChange | null)[] = [];
const dialogClosers: (() => void)[] = [];
vi.mock("../TurnChangeDialog", () => ({
  TurnChangeDialog: (props: { change: DisplayFileChange | null; onClose: () => void }) => {
    dialogs.push(props.change);
    dialogClosers.push(props.onClose);
    return null;
  },
}));

const finished = scenarios.finished;
const turnRunId = finished.fold.turns[0]!.runId;

/** The finished turn's run, with one change it captured. */
function runWithCapture() {
  const run = samples.run({ id: turnRunId, sessionId: finished.session!.metadata!.id });
  run.status = create(RunStatusSchema, {
    phase: finished.runs[0]!.status!.phase,
    fileChanges: [
      create(FileChangeSetSchema, {
        id: "cs-1",
        changes: [
          create(CapturedFileChangeSchema, {
            id: "c1",
            pathBefore: "src/billing/invoice.ts",
            pathAfter: "src/billing/invoice.ts",
            kind: FileChangeKind.MODIFY,
            diffComplete: true,
          }),
        ],
      }),
    ],
  });
  return run;
}

const run = runWithCapture();
const conv = { ...conversationOf(finished), runs: [run] };

vi.mock("../../file/useSessionFiles", () => ({
  useSessionFiles: () => ({ files: finished.files, isLoading: false, error: null, refetch: () => {} }),
}));

const workspace = {
  entries: [],
  hasEntries: false,
  toInput: () => [],
  addGitRepo: () => {},
  addLocalPath: () => {},
  remove: () => {},
  clear: () => {},
};

vi.mock("../useSessionPageFlow", () => ({
  useSessionPageFlow: () => ({
    conv,
    harness: "stigmer" as const,
    executionTarget: "cloud" as const,
    model: [undefined, () => {}] as const,
    interactionMode: ["agent" as const, () => {}] as const,
    agentRef: null,
    setAgentRef: () => {},
    resolution: null,
    setResolution: () => {},
    agentVersion: {
      pinnedHash: "",
      currentHash: "",
      agentName: "",
      isOutdated: false,
      labelOf: (hash: string) => hash,
      update: () => {},
      isUpdating: false,
      updateError: null,
    },
    pluginRefs: [],
    setPluginRefs: () => {},
    skillRefs: [],
    setSkillRefs: () => {},
    workspace,
    autoApproveAll: false,
    setAutoApproveAll: () => {},
    answerToolUse: () => {},
    handleSubmit: () => {},
    submitError: null,
    displayRun: run,
    allRuns: [run],
    sandboxWorkspaceRoot: undefined,
  }),
}));

vi.mock("../useSessionAccess", () => ({
  useSessionAccess: () => ({ canSend: true, canDecide: true }),
}));

vi.mock("../../hooks", () => ({
  useStigmer: () => ({
    platform: { getServerInfo: async () => ({}) },
    routine: { get: async () => Promise.reject(new Error("not found")) },
    // A builder grades runs: the scores read who is looking.
    identityAccount: { whoAmI: async () => Promise.reject(new Error("no account")) },
    score: { listBySession: async () => ({ entries: [], nextPageToken: "" }) },
    run: { getArtifactContent: vi.fn() },
  }),
}));

import { SessionViewer } from "../SessionViewer";

beforeEach(() => {
  composerProps.length = 0;
  previews.length = 0;
  dialogs.length = 0;
});

afterEach(cleanup);

/** The composer's configure-menu rows the host added. */
function settings() {
  return (composerProps.at(-1)?.extraSettings ?? []) as readonly { item: { id: string }; panel: React.ReactElement }[];
}

describe("SessionViewer without an inspector", () => {
  it("KIT-07 shows an end user no builder controls: no panel chip, and only the model and the switch in the run settings", () => {
    render(<SessionViewer sessionId="ses_1" org="demo" audience="endUser" />);
    expect(screen.queryByRole("button", { name: "Show panel" })).toBeNull();

    const row = settings().find((setting) => setting.item.id === "run-settings");
    expect(row).toBeDefined();
    cleanup();
    render(row!.panel);
    expect(screen.queryByText("Harness")).toBeNull();
    expect(screen.queryByText("Target")).toBeNull();
    expect(screen.getByRole("switch", { name: "Auto-approve" })).toBeTruthy();
  });

  it("KIT-07 shows a guest no run settings and no panel chip", () => {
    render(<SessionViewer sessionId="ses_1" org="demo" audience="guest" />);
    expect(screen.queryByRole("button", { name: "Show panel" })).toBeNull();
    expect(settings()).toEqual([]);
  });

  it("gives a builder's run settings the engine and target too", () => {
    render(<SessionViewer sessionId="ses_1" org="demo" />);
    const row = settings().find((setting) => setting.item.id === "run-settings")!;
    cleanup();
    render(row.panel);
    expect(screen.getByText("Harness")).toBeTruthy();
    expect(screen.getByText("Target")).toBeTruthy();
  });

  it("KIT-06 opens a File the turn returned in the File preview, from the turn's outcome", () => {
    render(<SessionViewer sessionId="ses_1" org="demo" audience="endUser" />);
    fireEvent.click(screen.getByRole("button", { name: /invoice-audit\.md/ }));
    expect(previews.at(-1)).toMatchObject({ open: true, file: finished.files[0], readOnly: false });
    act(() => previews.at(-1)!.onClose());
    expect(previews.at(-1)!.open).toBe(false);
  });

  it("opens a guest's File read only, offering no act its credential is refused", () => {
    render(<SessionViewer sessionId="ses_1" org="demo" audience="guest" />);
    fireEvent.click(screen.getByRole("button", { name: /invoice-audit\.md/ }));
    expect(previews.at(-1)).toMatchObject({ open: true, file: finished.files[0], readOnly: true, onApplied: undefined });
  });

  it("KIT-06 opens a change the run captured as its diff, from the turn's outcome", () => {
    render(<SessionViewer sessionId="ses_1" org="demo" audience="endUser" />);
    fireEvent.click(screen.getByRole("button", { name: "invoice.ts" }));
    expect(dialogs.at(-1)?.path).toBe("src/billing/invoice.ts");
    act(() => dialogClosers.at(-1)!());
    expect(dialogs.at(-1)).toBeNull();
  });
});
