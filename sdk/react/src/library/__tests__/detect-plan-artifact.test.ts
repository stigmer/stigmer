import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import {
  AgentExecutionSchema,
  AgentExecutionStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionArtifactSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";
import { ExecutionArtifactKind } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import {
  isPlanArtifact,
  findPlanArtifact,
  findLatestSessionPlan,
  PLAN_ARTIFACT_NAME,
} from "../detect-plan-artifact";

function artifact(opts: { name: string; kind?: ExecutionArtifactKind; storageKey?: string }) {
  return create(ExecutionArtifactSchema, {
    name: opts.name,
    kind: opts.kind ?? ExecutionArtifactKind.FILE,
    storageKey: opts.storageKey ?? `artifacts/exec/${opts.name}`,
  });
}

function executionWith(...artifacts: ReturnType<typeof artifact>[]) {
  return create(AgentExecutionSchema, {
    status: create(AgentExecutionStatusSchema, { artifacts }),
  });
}

function executionWithId(id: string, ...artifacts: ReturnType<typeof artifact>[]) {
  return create(AgentExecutionSchema, {
    metadata: create(ApiResourceMetadataSchema, { id }),
    status: create(AgentExecutionStatusSchema, { artifacts }),
  });
}

describe("isPlanArtifact", () => {
  it("is true for a FILE artifact named plan.md", () => {
    expect(isPlanArtifact(artifact({ name: PLAN_ARTIFACT_NAME }))).toBe(true);
  });

  it("is false for a directory named plan.md", () => {
    expect(
      isPlanArtifact(artifact({ name: "plan.md", kind: ExecutionArtifactKind.DIRECTORY })),
    ).toBe(false);
  });

  it("is false for other file names", () => {
    expect(isPlanArtifact(artifact({ name: "report.md" }))).toBe(false);
    expect(isPlanArtifact(artifact({ name: "plan.txt" }))).toBe(false);
  });
});

describe("findPlanArtifact", () => {
  it("returns undefined for null/empty executions", () => {
    expect(findPlanArtifact(null)).toBeUndefined();
    expect(findPlanArtifact(undefined)).toBeUndefined();
    expect(findPlanArtifact(executionWith())).toBeUndefined();
  });

  it("finds the plan.md among other artifacts", () => {
    const exec = executionWith(
      artifact({ name: "notes.txt" }),
      artifact({ name: PLAN_ARTIFACT_NAME, storageKey: "artifacts/exec/plan.md" }),
      artifact({ name: "data.json" }),
    );
    const plan = findPlanArtifact(exec);
    expect(plan?.name).toBe(PLAN_ARTIFACT_NAME);
    expect(plan?.storageKey).toBe("artifacts/exec/plan.md");
  });

  it("returns the latest plan.md when more than one is present", () => {
    const exec = executionWith(
      artifact({ name: PLAN_ARTIFACT_NAME, storageKey: "artifacts/exec/plan.md#old" }),
      artifact({ name: PLAN_ARTIFACT_NAME, storageKey: "artifacts/exec/plan.md#new" }),
    );
    expect(findPlanArtifact(exec)?.storageKey).toBe("artifacts/exec/plan.md#new");
  });

  it("returns undefined when no plan artifact exists", () => {
    expect(findPlanArtifact(executionWith(artifact({ name: "report.md" })))).toBeUndefined();
  });
});

describe("findLatestSessionPlan", () => {
  it("returns undefined when no execution published a plan", () => {
    const execs = [
      executionWithId("e1", artifact({ name: "report.md" })),
      executionWithId("e2"),
    ];
    expect(findLatestSessionPlan(execs)).toBeUndefined();
    expect(findLatestSessionPlan([])).toBeUndefined();
  });

  it("returns the newest plan across executions, with its execution id", () => {
    const execs = [
      executionWithId("e1", artifact({ name: PLAN_ARTIFACT_NAME, storageKey: "artifacts/e1/plan.md" })),
      executionWithId("e2", artifact({ name: "notes.txt" })),
      executionWithId("e3", artifact({ name: PLAN_ARTIFACT_NAME, storageKey: "artifacts/e3/plan.md" })),
    ];

    const plan = findLatestSessionPlan(execs);
    expect(plan?.executionId).toBe("e3");
    expect(plan?.artifact.storageKey).toBe("artifacts/e3/plan.md");
  });

  it("skips a newer plan-less execution and returns the older plan", () => {
    const execs = [
      executionWithId("e1", artifact({ name: PLAN_ARTIFACT_NAME })),
      executionWithId("e2", artifact({ name: "data.json" })),
    ];
    expect(findLatestSessionPlan(execs)?.executionId).toBe("e1");
  });

  it("skips an execution whose plan artifact lacks a usable execution id", () => {
    const execs = [
      executionWithId("e1", artifact({ name: PLAN_ARTIFACT_NAME })),
      executionWith(artifact({ name: PLAN_ARTIFACT_NAME })),
    ];
    expect(findLatestSessionPlan(execs)?.executionId).toBe("e1");
  });
});
