/**
 * Pins which model the attachment phase asks the registry about when it
 * sizes the vision budget (`turn-context.ts` `resolveTurnAttachments`): the
 * model the execution named, or the registry's default when it named none —
 * the model the native harness will build in that case. Before S3 M1 the
 * phase asked about the raw executionConfig name, so an execution with no
 * model named asked about `""` (always "unknown", read as sighted) while the
 * native orchestrator asked about the resolved default (its `setup.ts`,
 * retired with it).
 *
 * The registry module is doubled at its boundary: this test is about WHICH
 * name is asked, not about the registry's answer. The phase is entered with
 * no attachments so nothing touches the file system; the budget's decisions
 * over real images are `shared/__tests__/attachment-vision.test.ts`'s.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentExecutionSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";

vi.mock("../../shared/model-registry.js", () => ({
  getDefaultModel: vi.fn(async () => "registry-default-model"),
  getModelVisionCapability: vi.fn(async () => true),
}));

import { getDefaultModel, getModelVisionCapability } from "../../shared/model-registry.js";
import { DEEP_AGENT_VISION_PROFILE } from "../../shared/attachment-vision.js";
import { TimingRecorder } from "../../shared/cold-start-timing.js";
import { mockStigmerClient } from "../../__test-utils__/mock-client.js";
import { testConfig } from "../../__test-utils__/config-fixture.js";
import { resolveTurnAttachments, type ResolutionDeps } from "../turn-context.js";

function deps(): ResolutionDeps {
  return {
    input: { executionId: "aex_1", threadId: "", turnSeq: 0 },
    client: mockStigmerClient(),
    config: testConfig(),
    status: create(AgentExecutionStatusSchema, {}),
    artifactStorage: undefined,
    timing: new TimingRecorder(),
    signal: new AbortController().signal,
    heartbeat: () => {},
    enterPhase: () => {},
    reportProgress: async () => {},
  };
}

async function resolveWithModel(modelName: string | undefined): Promise<void> {
  await resolveTurnAttachments(deps(), {
    spec: create(AgentExecutionSpecSchema, modelName === undefined ? {} : { executionConfig: { modelName } }),
    sessionId: "ses_1",
    primaryDir: "/nowhere",
    visionProfile: DEEP_AGENT_VISION_PROFILE,
  });
}

describe("resolveTurnAttachments: the model the vision budget asks about", () => {
  beforeEach(() => {
    vi.mocked(getDefaultModel).mockClear();
    vi.mocked(getModelVisionCapability).mockClear();
  });

  it("asks about the model the execution named, without consulting the default", async () => {
    await resolveWithModel("claude-haiku-4.5");
    expect(vi.mocked(getModelVisionCapability)).toHaveBeenCalledWith("claude-haiku-4.5");
    expect(vi.mocked(getDefaultModel)).not.toHaveBeenCalled();
  });

  it("asks about the registry's default when the execution named none — the model the turn will run on, not the empty string", async () => {
    await resolveWithModel(undefined);
    expect(vi.mocked(getDefaultModel)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getModelVisionCapability)).toHaveBeenCalledWith("registry-default-model");
  });

  it("treats an empty model name as none", async () => {
    await resolveWithModel("");
    expect(vi.mocked(getModelVisionCapability)).toHaveBeenCalledWith("registry-default-model");
  });
});
