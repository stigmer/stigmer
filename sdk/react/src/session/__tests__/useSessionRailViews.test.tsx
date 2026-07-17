import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";

// ---------------------------------------------------------------------------
// useSessionRailViews composes the session facets as injected rail views for
// the workspace surface. The facet components themselves have their own
// suites; here we prove the composition rules — ordering, contextual
// visibility (Changes/Artifacts only with data), and count badges — by
// mocking the aggregation hooks.
// ---------------------------------------------------------------------------

const writeBacksState = { hasWriteBacks: false, writeBackCount: 0 };
const artifactsState = { hasArtifacts: false, artifactCount: 0 };

vi.mock("../useSessionWriteBacks", () => ({
  useSessionWriteBacks: () => writeBacksState,
}));
vi.mock("../useSessionArtifacts", () => ({
  useSessionArtifacts: () => artifactsState,
}));

import { useSessionRailViews } from "../useSessionRailViews";
import type { SetupTabProps } from "../facets/SetupTab";

const sessionConfig = {
  agentRef: null,
  isDefaultAgent: true,
  mcpServerUsages: [],
  skillRefs: [],
  sessionVariables: null,
  harness: "native",
  executionTarget: undefined,
  modelId: undefined,
} as SetupTabProps;

function renderViews(
  overrides: Partial<Parameters<typeof useSessionRailViews>[0]> = {},
) {
  return renderHook(() =>
    useSessionRailViews({
      allExecutions: [],
      org: "acme",
      sessionConfig,
      ...overrides,
    }),
  );
}

afterEach(() => {
  cleanup();
  writeBacksState.hasWriteBacks = false;
  writeBacksState.writeBackCount = 0;
  artifactsState.hasArtifacts = false;
  artifactsState.artifactCount = 0;
});

describe("useSessionRailViews", () => {
  it("always offers Config and Usage; Changes/Artifacts are contextual", () => {
    const { result } = renderViews();
    expect(result.current.map((v) => v.id)).toEqual(["configure", "usage"]);
  });

  it("omits Config when no session configuration is provided", () => {
    const { result } = renderViews({ sessionConfig: undefined });
    expect(result.current.map((v) => v.id)).toEqual(["usage"]);
  });

  it("surfaces Changes with a write-back count badge", () => {
    writeBacksState.hasWriteBacks = true;
    writeBacksState.writeBackCount = 2;
    const { result } = renderViews();
    const changes = result.current.find((v) => v.id === "changes");
    expect(changes?.badge).toBe(2);
    expect(result.current.map((v) => v.id)).toEqual([
      "configure",
      "changes",
      "usage",
    ]);
  });

  it("offers Changes pre-push when a write-back is expected, without a zero badge", () => {
    const { result } = renderViews({ expectsWriteBack: true });
    const changes = result.current.find((v) => v.id === "changes");
    expect(changes, "cloud git sessions get the facet before any push").toBeTruthy();
    expect(changes?.badge).toBeUndefined();
  });

  it("hides Changes when no write-back exists and none is expected", () => {
    const { result } = renderViews({ expectsWriteBack: false });
    expect(result.current.some((v) => v.id === "changes")).toBe(false);
  });

  it("surfaces Artifacts with a count badge", () => {
    artifactsState.hasArtifacts = true;
    artifactsState.artifactCount = 4;
    const { result } = renderViews();
    const artifacts = result.current.find((v) => v.id === "artifacts");
    expect(artifacts?.badge).toBe(4);
  });

  it("keeps full inspector ordering: Config, Changes, Artifacts, Usage", () => {
    writeBacksState.hasWriteBacks = true;
    writeBacksState.writeBackCount = 1;
    artifactsState.hasArtifacts = true;
    artifactsState.artifactCount = 1;
    const { result } = renderViews();
    expect(result.current.map((v) => v.id)).toEqual([
      "configure",
      "changes",
      "artifacts",
      "usage",
    ]);
  });
});
