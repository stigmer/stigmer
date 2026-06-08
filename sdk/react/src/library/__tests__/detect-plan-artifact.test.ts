import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import {
  AgentExecutionSchema,
  AgentExecutionStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionArtifactSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";
import { ExecutionArtifactKind } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import {
  isPlanArtifact,
  findPlanArtifact,
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
