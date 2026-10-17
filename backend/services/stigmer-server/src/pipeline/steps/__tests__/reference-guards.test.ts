/**
 * Pins the guards the steps that read a reference keep once references hold
 * ids (references.ts): each one asks for an id or a slug, names a target it
 * cannot find by what the request wrote (its slug, else its id), and answers
 * a fault reading the target INTERNAL, never a refusal.
 *
 * Over the steps alone, with a store that answers nothing or fails:
 *   - the schedule and channel defaults (a web channel's and a Slack
 *     channel's alike) refuse an agent_ref that names nothing,
 *     INVALID_ARGUMENT, in their copy;
 *   - the schedule and channel defaults answer a failed agent read INTERNAL;
 *   - getByReference's shared loader refuses a reference that names
 *     nothing and names a missing target by its id.
 */
import { create } from "@bufbuild/protobuf";
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { ChannelSchema } from "@stigmer/protos/ai/stigmer/agentic/channel/v1/api_pb";
import { RoutineSchema } from "@stigmer/protos/ai/stigmer/agentic/routine/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";

import { AGENT_REF_REQUIRED_MESSAGE as CHANNEL_AGENT_REF_REQUIRED } from "../../../domain/channel/constants.js";
import { newResolveChannelDefaultsStep } from "../../../domain/channel/steps.js";
import { newResolveRoutineDefaultsStep } from "../../../domain/routine/steps.js";
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

/** A web channel (what a hosted chat link is) whose agent_ref names what the case gives. */
const webChannel = (agentRef?: { id?: string; slug?: string }) =>
  create(ChannelSchema, {
    metadata: { org: ORG },
    spec: { agentRef: agentRef && { org: ORG, ...agentRef }, type: { case: "web", value: {} } },
  });

const routine = (agentRef?: { id?: string; slug?: string }) =>
  create(RoutineSchema, {
    metadata: { org: ORG },
    spec: {
      cron: "0 9 * * *",
      timeZone: "UTC",
      target: { case: "agent", value: { agentRef: agentRef && { org: ORG, ...agentRef } } },
    },
  });

/** A Slack channel whose agent_ref names what the case gives. */
const channel = (agentRef?: { id?: string; slug?: string }) =>
  create(ChannelSchema, {
    metadata: { org: ORG },
    spec: { agentRef: agentRef && { org: ORG, ...agentRef }, type: { case: "slack", value: {} } },
  });

describe("the defaults steps ask for an agent_ref that names its agent", () => {
  it("the web channel's refuses one that names nothing, INVALID_ARGUMENT", async () => {
    const step = newResolveChannelDefaultsStep(empty, noCatalogue, undefined);
    const error = await refusal(step, ChannelSchema, webChannel({}), ApiResourceKind.channel);
    expect([error.code, error.rawMessage]).toEqual([Code.InvalidArgument, CHANNEL_AGENT_REF_REQUIRED]);
  });

  it("the schedule's refuses one that names nothing, and answers a failed agent read INTERNAL", async () => {
    const step = (store: Store) => newResolveRoutineDefaultsStep({ store, modelRegistry: noCatalogue });
    const missing = await refusal(step(empty), RoutineSchema, routine(), ApiResourceKind.routine);
    expect([missing.code, missing.rawMessage]).toEqual([Code.InvalidArgument, "spec.agent.agent_ref is required"]);
    const fault = await refusal(step(failing), RoutineSchema, routine({ id: "agt_1" }), ApiResourceKind.routine);
    expect(fault.code).toBe(Code.Internal);
  });

  it("the channel's refuses one that names nothing, and answers a failed agent read INTERNAL", async () => {
    const step = (store: Store) => newResolveChannelDefaultsStep(store, noCatalogue, undefined);
    const missing = await refusal(step(empty), ChannelSchema, channel(), ApiResourceKind.channel);
    expect([missing.code, missing.rawMessage]).toEqual([Code.InvalidArgument, CHANNEL_AGENT_REF_REQUIRED]);
    const fault = await refusal(step(failing), ChannelSchema, channel({ id: "agt_1" }), ApiResourceKind.channel);
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
