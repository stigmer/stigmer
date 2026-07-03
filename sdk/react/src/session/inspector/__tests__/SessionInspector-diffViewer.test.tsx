import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  FileChangeSchema,
  type FileChange,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { FileChangeType } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

// ---------------------------------------------------------------------------
// Wiring-contract test for Slice 4: SessionInspector folds session file changes
// and hands the ONE that touches the open file to FileViewer as `change` (so a
// changed file defaults to its diff). FileViewer is a prop-capturing probe; the
// fold + join (findChangeForSelection) under test are real. useSessionFileChanges
// is mocked so no ledger fixtures are needed — the correlation is exercised by
// findChangeForSelection's own suite; here we prove the wire.
// ---------------------------------------------------------------------------

type CapturedProps = Record<string, unknown>;

const viewerProps: CapturedProps[] = [];
vi.mock("../../../workspace/FileViewer", () => ({
  FileViewer: (props: CapturedProps) => {
    viewerProps.push(props);
    return <div data-testid="viewer-probe" />;
  },
}));

let mockFileChanges: FileChange[] = [];
vi.mock("../../useSessionFileChanges", () => ({
  useSessionFileChanges: (executions: readonly unknown[]) => ({
    // Honor the EMPTY_EXECUTIONS gate: no executions in → no changes out.
    fileChanges: executions.length > 0 ? mockFileChanges : [],
    hasFileChanges: executions.length > 0 && mockFileChanges.length > 0,
    fileChangeCount: executions.length > 0 ? mockFileChanges.length : 0,
  }),
}));

// The other execution-aggregation folds need a StigmerProvider (usage) and are
// not the subject here; stub them to keep the probe hermetic.
vi.mock("../../useSessionUsage", () => ({
  useSessionUsage: () => ({ hasUsage: false }),
}));
vi.mock("../../useSessionWriteBacks", () => ({
  useSessionWriteBacks: () => ({ hasWriteBacks: false, writeBackCount: 0, writeBacks: [] }),
}));
vi.mock("../../useSessionArtifacts", () => ({
  useSessionArtifacts: () => ({ hasArtifacts: false, artifactCount: 0 }),
}));

import { SessionInspector, type SessionInspectorProps } from "../SessionInspector";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";

const gitEntry = {
  id: "e1",
  name: "acme/app",
  type: "git" as const,
  gitUrl: "https://github.com/acme/app.git",
  gitBranch: "main",
};

const workspaceConfig = {
  actions: {
    workspace: { entries: [gitEntry] },
    workspaceFileReader: vi.fn(async () => null),
    onOpenFile: vi.fn(),
    enableGitHub: true,
    enableLocal: false,
  },
} as unknown as SessionInspectorProps["workspaceConfig"];

// A non-empty stand-in; useSessionFileChanges is mocked, so its shape is unread.
const allExecutions = [{} as AgentExecution];

function modifyChange(path: string): FileChange {
  return create(FileChangeSchema, { path, changeType: FileChangeType.MODIFY });
}

function renderInspector(selectedFile: SessionInspectorProps["selectedFile"]) {
  return render(
    <SessionInspector
      displayExecution={null}
      allExecutions={allExecutions}
      org="acme"
      selectedItem={null}
      selectedFile={selectedFile}
      sandboxWorkspaceRoot="/home/daytona/workspace"
      workspaceConfig={workspaceConfig}
    />,
  );
}

function latestViewerChange(): unknown {
  return viewerProps.at(-1)?.change;
}

beforeEach(() => {
  viewerProps.length = 0;
  mockFileChanges = [];
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SessionInspector — diff viewer wiring", () => {
  it("hands the matching session change to the viewer for the open file", () => {
    mockFileChanges = [modifyChange("src/a.ts")];
    renderInspector({ entryId: "e1", path: "src/a.ts" });

    expect(latestViewerChange()).toBe(mockFileChanges[0]);
  });

  it("passes no change when the open file was not changed this session", () => {
    mockFileChanges = [modifyChange("src/a.ts")];
    renderInspector({ entryId: "e1", path: "src/other.ts" });

    expect(latestViewerChange()).toBeUndefined();
  });

  it("passes no change when the session has no file changes", () => {
    mockFileChanges = [];
    renderInspector({ entryId: "e1", path: "src/a.ts" });

    expect(latestViewerChange()).toBeUndefined();
  });
});
