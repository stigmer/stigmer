/**
 * Pins the guards the steps that read a reference keep once references hold
 * ids (references.ts): each one asks for an id or a slug, names a target it
 * cannot find by what the request wrote (its slug, else its id), and answers
 * a fault reading the target INTERNAL, never a refusal.
 *
 * Over the steps alone, with a store that answers nothing or fails:
 *   - the share, schedule and channel defaults refuse an agent_ref that
 *     names nothing, INVALID_ARGUMENT, in their copy;
 *   - the schedule and channel defaults answer a failed agent read INTERNAL;
 *   - getByReference's shared loader refuses a reference that names
 *     nothing and names a missing target by its id.
 */
import { create } from "@bufbuild/protobuf";
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentChannelSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import { AgentShareSchema } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/api_pb";
import { ScheduleSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";

import { AGENT_REF_REQUIRED_MESSAGE as CHANNEL_AGENT_REF_REQUIRED } from "../../../domain/agentchannel/constants.js";
import { newResolveChannelDefaultsStep } from "../../../domain/agentchannel/steps.js";
import { AGENT_REF_REQUIRED_MESSAGE as SHARE_AGENT_REF_REQUIRED } from "../../../domain/agentshare/constants.js";
import { newResolveShareDefaultsStep } from "../../../domain/agentshare/steps.js";
import { newResolveScheduleDefaultsStep } from "../../../domain/schedule/steps.js";
import type { ModelCatalogProvider } from "../../../modelcatalog/model-catalog-provider.js";
import type { Store } from "../../../store/interface.js";
import { ResourceNotFoundError } from "../../../store/interface.js";
import { testCallerIdentity } from "../../__tests__/support.js";
import type { PipelineStep } from "../../pipeline.js";
import { RequestContext } from "../../request-context.js";
import { newLoadByReferenceStep } from "../load-by-reference.js";
import { TARGET_RESOURCE_KEY } from "../load-target.js";

const ORG = "org_01jz00000000000000000acme0";

/** A store that holds no row of any kind. */
const empty = {
  getResource: () => Promise.reject(new ResourceNotFoundError("agent any")),
} as unknown as Store;

/** A store whose reads fail, as a database fault would. */
const failing = {
  getResource: () => Promise.reject(new Error("database offline")),
} as unknown as Store;

/** A model catalogue the steps must not consult: no request here pins a model. */
const noCatalogue = {} as ModelCatalogProvider;

/** The step's refusal, or a failure when it passes. */
async function refusal<Desc extends DescMessage>(
  step: PipelineStep<Desc>,
  schema: Desc,
  state: MessageShape<Desc>,
  kind: ApiResourceKind,
): Promise<ConnectError> {
  try {
    await step.execute(new RequestContext(schema, state, testCallerIdentity(), kind));
  } catch (error) {
    if (error instanceof ConnectError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected the step to refuse");
}

const share = (agentRef?: { id?: string; slug?: string }) =>
  create(AgentShareSchema, { metadata: { org: ORG }, spec: { agentRef: agentRef && { org: ORG, ...agentRef } } });

const schedule = (agentRef?: { id?: string; slug?: string }) =>
  create(ScheduleSchema, {
    metadata: { org: ORG },
    spec: {
      cron: "0 9 * * *",
      timeZone: "UTC",
      target: { case: "agent", value: { agentRef: agentRef && { org: ORG, ...agentRef } } },
    },
  });

const channel = (agentRef?: { id?: string; slug?: string }) =>
  create(AgentChannelSchema, { metadata: { org: ORG }, spec: { agentRef: agentRef && { org: ORG, ...agentRef } } });

describe("the defaults steps ask for an agent_ref that names its agent", () => {
  it("the share's refuses one that names nothing, INVALID_ARGUMENT", async () => {
    const error = await refusal(newResolveShareDefaultsStep(empty), AgentShareSchema, share({}), ApiResourceKind.agent_share);
    expect([error.code, error.rawMessage]).toEqual([Code.InvalidArgument, SHARE_AGENT_REF_REQUIRED]);
  });

  it("the schedule's refuses one that names nothing, and answers a failed agent read INTERNAL", async () => {
    const step = (store: Store) => newResolveScheduleDefaultsStep({ store, modelRegistry: noCatalogue });
    const missing = await refusal(step(empty), ScheduleSchema, schedule(), ApiResourceKind.schedule);
    expect([missing.code, missing.rawMessage]).toEqual([Code.InvalidArgument, "spec.agent.agent_ref is required"]);
    const fault = await refusal(step(failing), ScheduleSchema, schedule({ id: "agt_1" }), ApiResourceKind.schedule);
    expect(fault.code).toBe(Code.Internal);
  });

  it("the channel's refuses one that names nothing, and answers a failed agent read INTERNAL", async () => {
    const step = (store: Store) => newResolveChannelDefaultsStep(store, noCatalogue, undefined);
    const missing = await refusal(step(empty), AgentChannelSchema, channel(), ApiResourceKind.agent_channel);
    expect([missing.code, missing.rawMessage]).toEqual([Code.InvalidArgument, CHANNEL_AGENT_REF_REQUIRED]);
    const fault = await refusal(step(failing), AgentChannelSchema, channel({ id: "agt_1" }), ApiResourceKind.agent_channel);
    expect(fault.code).toBe(Code.Internal);
  });
});

describe("getByReference names a missing target by what the request wrote", () => {
  const reference = (init: { org?: string; id?: string; slug?: string }) => create(ApiResourceReferenceSchema, init);

  it("the shared loader refuses a reference naming nothing, and names a missing id", async () => {
    const step = newLoadByReferenceStep(empty, AgentSchema);
    const nothing = await refusal(step, ApiResourceReferenceSchema, reference({ org: ORG }), ApiResourceKind.agent);
    expect([nothing.code, nothing.rawMessage]).toEqual([Code.InvalidArgument, "slug or id is required in reference"]);
    const gone = await refusal(step, ApiResourceReferenceSchema, reference({ id: "agt_gone" }), ApiResourceKind.agent);
    expect(gone.code).toBe(Code.NotFound);
    expect(gone.rawMessage).toContain("agt_gone");
  });
});
