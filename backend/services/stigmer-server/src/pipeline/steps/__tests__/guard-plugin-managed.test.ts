/**
 * Pins the plugin-managed write guard's two-fact decision: a stored
 * resource labelled with an EXISTING plugin's id refuses a client write
 * with FAILED_PRECONDITION naming the plugin; a label whose plugin is gone
 * locks nothing; an unlabelled resource passes; in-process and internal
 * callers pass by structure; the request's own labels are never consulted;
 * and the step reads the context key the chain names.
 */
import { describe, expect, it } from "vitest";
import { Code, ConnectError } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { CallerIdentity } from "../../../extensions/identity.js";
import { PLUGIN_LABEL } from "../../apiresource-labels.js";
import { RequestContext } from "../../request-context.js";
import { ResourceNotFoundError } from "../../../store/interface.js";
import type { Store } from "../../../store/interface.js";
import { newGuardPluginManagedStep } from "../guard-plugin-managed.js";
import { EXISTING_RESOURCE_KEY } from "../load-existing.js";

const USER: CallerIdentity = {
  identityId: "ida_alice",
  callerClass: "user",
  issuer: "stigmer",
  rawToken: "tok",
};
const IN_PROCESS: CallerIdentity = { ...USER, origin: "in-process" };
const INTERNAL: CallerIdentity = { ...USER, callerClass: "internal" };

/** A store that knows one plugin row; everything else is not found. */
function storeWith(pluginId: string | undefined): Store {
  return {
    getResource: (kind: ApiResourceKind, id: string) => {
      if (kind === ApiResourceKind.plugin && id === pluginId) {
        return Promise.resolve(
          create(PluginSchema, { metadata: { id, slug: "thermos" } }),
        );
      }
      return Promise.reject(
        new ResourceNotFoundError(`${ApiResourceKind[kind]}/${id}`),
      );
    },
  } as unknown as Store;
}

function ctxWithStored(
  labels: Record<string, string>,
  caller: CallerIdentity,
  key = EXISTING_RESOURCE_KEY,
) {
  const ctx = new RequestContext(
    AgentSchema,
    // The REQUEST carries no plugin label: the guard must not read it.
    create(AgentSchema, { metadata: { name: "reviewer", labels: {} } }),
    caller,
    ApiResourceKind.agent,
  );
  ctx.set(
    key,
    create(AgentSchema, {
      metadata: { name: "reviewer", slug: "reviewer", labels },
    }),
  );
  return ctx;
}

async function outcome(
  promise: Promise<void> | void,
): Promise<ConnectError | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error as ConnectError;
  }
}

describe("GuardPluginManaged", () => {
  it("refuses a client write to a member whose plugin exists, naming the plugin", async () => {
    const step = newGuardPluginManagedStep<typeof AgentSchema>(
      storeWith("plg_1"),
    );
    const error = await outcome(
      step.execute(ctxWithStored({ [PLUGIN_LABEL]: "plg_1" }, USER)),
    );
    expect(error).toBeInstanceOf(ConnectError);
    expect(error?.code).toBe(Code.FailedPrecondition);
    expect(error?.rawMessage).toBe(
      "agent 'reviewer' is managed by plugin 'thermos'; change the plugin and push it again, or compose your own agent over it",
    );
  });

  it("locks nothing when the labelled plugin is gone", async () => {
    const step = newGuardPluginManagedStep<typeof AgentSchema>(
      storeWith(undefined),
    );
    expect(
      await outcome(
        step.execute(ctxWithStored({ [PLUGIN_LABEL]: "plg_gone" }, USER)),
      ),
    ).toBeUndefined();
  });

  it("passes an unlabelled resource without touching the store", async () => {
    const step = newGuardPluginManagedStep<typeof AgentSchema>({
      getResource: () => Promise.reject(new Error("must not be called")),
    } as unknown as Store);
    expect(
      await outcome(step.execute(ctxWithStored({ team: "x" }, USER))),
    ).toBeUndefined();
  });

  it("passes in-process and internal callers by structure", async () => {
    const step = newGuardPluginManagedStep<typeof AgentSchema>(
      storeWith("plg_1"),
    );
    expect(
      await outcome(
        step.execute(ctxWithStored({ [PLUGIN_LABEL]: "plg_1" }, IN_PROCESS)),
      ),
    ).toBeUndefined();
    expect(
      await outcome(
        step.execute(ctxWithStored({ [PLUGIN_LABEL]: "plg_1" }, INTERNAL)),
      ),
    ).toBeUndefined();
  });

  it("reads the stored resource from the key the chain names", async () => {
    const step = newGuardPluginManagedStep<typeof AgentSchema>(
      storeWith("plg_1"),
      { existingKey: "customKey" },
    );
    const error = await outcome(
      step.execute(
        ctxWithStored({ [PLUGIN_LABEL]: "plg_1" }, USER, "customKey"),
      ),
    );
    expect(error?.code).toBe(Code.FailedPrecondition);
    // Under the default key nothing is loaded, so nothing is refused.
    expect(
      await outcome(
        step.execute(ctxWithStored({ [PLUGIN_LABEL]: "plg_1" }, USER)),
      ),
    ).toBeUndefined();
  });
});
