/**
 * Pins which model the attachment phase asks the registry about when it
 * sizes the vision budget (`turn-context.ts` `resolveTurnAttachments`): the
 * model the turn's resolved settings name (`status.run_config`), or the
 * registry's default when they name none — the model the native harness
 * will build in that case — and never the model the request asked for.
 * Before #1096 the phase asked about the raw requested name, so an
 * execution with no model named asked about `""` (always "unknown", read as
 * sighted) while the native orchestrator asked about the resolved default
 * (its `setup.ts`, retired with it).
 *
 * The registry module is doubled at its boundary: this test is about WHICH
 * name is asked, not about the registry's answer. The phase is entered with
 * no attachments so nothing touches the file system; the budget's decisions
 * over real images are `shared/__tests__/attachment-vision.test.ts`'s.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { RunStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/spec_pb";
import { RunConfigSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/invocation_pb";

vi.mock("../../shared/model-registry.js", () => ({
  getDefaultModel: vi.fn(async () => "registry-default-model"),
  getModelVisionCapability: vi.fn(async () => true),
}));

import { getDefaultModel, getModelVisionCapability } from "../../shared/model-registry.js";
import { DEEP_AGENT_VISION_PROFILE } from "../../shared/attachment-vision.js";
import { TimingRecorder } from "../../shared/cold-start-timing.js";
import { mockStigmerClient } from "../../__test-utils__/mock-client.js";
import { testConfig } from "../../__test-utils__/config-fixture.js";
import { TranscriptBuilder } from "../transcript/builder.js";
import { resolveTurnAttachments, type ResolutionDeps } from "../turn-context.js";

function deps(): ResolutionDeps {
  const status = create(RunStatusSchema, {});
  return {
    input: { executionId: "aex_1", threadId: "", turnSeq: 0 },
    client: mockStigmerClient(),
    config: testConfig(),
    status,
    transcript: new TranscriptBuilder("aex_1", status),
    artifactStorage: undefined,
    timing: new TimingRecorder(),
    signal: new AbortController().signal,
    heartbeat: () => {},
    enterPhase: () => {},
    reportProgress: async () => {},
  };
}

async function resolveWithModel(modelName: string | undefined, requestedModelName?: string): Promise<void> {
  await resolveTurnAttachments(deps(), {
    spec: create(
      RunSpecSchema,
      requestedModelName === undefined ? {} : { runConfig: { modelName: requestedModelName } },
    ),
    runConfig: modelName === undefined ? undefined : create(RunConfigSchema, { modelName }),
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

  it("asks about the model the turn's resolved settings name, without consulting the default", async () => {
    await resolveWithModel("claude-haiku-4.5");
    expect(vi.mocked(getModelVisionCapability)).toHaveBeenCalledWith("claude-haiku-4.5");
    expect(vi.mocked(getDefaultModel)).not.toHaveBeenCalled();
  });

  it("asks about the registry's default when the resolved settings name none — the model the turn will run on, not the empty string", async () => {
    await resolveWithModel(undefined);
    expect(vi.mocked(getDefaultModel)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getModelVisionCapability)).toHaveBeenCalledWith("registry-default-model");
  });

  it("treats an empty model name as none", async () => {
    await resolveWithModel("");
    expect(vi.mocked(getModelVisionCapability)).toHaveBeenCalledWith("registry-default-model");
  });

  it("asks about the resolved model, never the one the request asked for", async () => {
    await resolveWithModel("resolved-model", "requested-model");
    expect(vi.mocked(getModelVisionCapability)).toHaveBeenCalledWith("resolved-model");
    expect(vi.mocked(getModelVisionCapability)).not.toHaveBeenCalledWith("requested-model");
  });

  it("falls to the registry's default when only the request names a model", async () => {
    await resolveWithModel(undefined, "requested-model");
    expect(vi.mocked(getModelVisionCapability)).toHaveBeenCalledWith("registry-default-model");
  });
});
