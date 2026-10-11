/**
 * Pins GuardUnlisted (../guard-unlisted.ts), the one delete-chain step for
 * a plugin an agent lists in spec.plugins and an agent another agent lists
 * in spec.subagents, over a real store:
 *   - an agent of the target's own organization that lists it refuses the
 *     delete FAILED_PRECONDITION, naming every lister in sorted order and
 *     the field to remove it from;
 *   - a reference filed without an organization reads as the lister's own;
 *   - an agent of another organization (a child organization's agent that
 *     lists its parent's shared agent among them) never blocks, nor does a
 *     same-slug reference of another kind, nor the target itself;
 *   - the plugin's refusal keeps the sentence the plugin guard always said;
 *   - a chain that reached the step without the loaded target, and a store
 *     that cannot list agents, are INTERNAL.
 */
import { create } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceIdSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import type { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";

import type { Store } from "../../../store/interface.js";
import type { SqliteStore } from "../../../store/sqlite/store.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import { testCallerIdentity } from "../../__tests__/support.js";
import { RequestContext } from "../../request-context.js";
import {
  UNLISTED_AGENT,
  UNLISTED_PLUGIN,
  newGuardUnlistedStep,
  stillListedMessage,
} from "../guard-unlisted.js";
import { EXISTING_RESOURCE_KEY } from "../load-existing.js";

const PARENT_ORG = "org_parent";
const CHILD_ORG = "org_child";

type ReferenceInit = MessageInitShape<typeof ApiResourceReferenceSchema>;

let store: SqliteStore;
let cleanup: () => Promise<void>;

beforeEach(() => {
  const temp = tempStore();
  store = temp.store;
  cleanup = temp.cleanup;
});

afterEach(async () => {
  await cleanup();
});

async function seedAgent(
  id: string,
  org: string,
  slug: string,
  lists: { subagents?: ReferenceInit[]; plugins?: ReferenceInit[]; skillRefs?: ReferenceInit[] } = {},
): Promise<void> {
  await store.saveResource(
    ApiResourceKind.agent,
    id,
    AgentSchema,
    create(AgentSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Agent",
      metadata: { id, name: slug, slug, org },
      spec: { instructions: `The ${slug} agent's instructions.`, ...lists },
    }),
  );
}

function agentRef(slug: string, org = PARENT_ORG): ReferenceInit {
  return { kind: ApiResourceKind.agent, org, slug };
}

/** Runs the guard for an agent delete with `target` loaded (none to skip the load). */
async function deleteAgent(
  target: { id: string; org: string; slug: string } | undefined,
  over: Store = store,
): Promise<unknown> {
  const ctx = new RequestContext(
    ApiResourceIdSchema,
    create(ApiResourceIdSchema, { value: target?.id ?? "" }),
    testCallerIdentity(),
    ApiResourceKind.agent,
  );
  if (target !== undefined) {
    ctx.set(
      EXISTING_RESOURCE_KEY,
      create(AgentSchema, { metadata: { id: target.id, slug: target.slug, org: target.org } }),
    );
  }
  try {
    await newGuardUnlistedStep<typeof ApiResourceIdSchema>(over, UNLISTED_AGENT).execute(ctx);
    return undefined;
  } catch (error) {
    return error;
  }
}

const HELPER = { id: "agt_helper", org: PARENT_ORG, slug: "helper" };

describe("GuardUnlisted for an agent", () => {
  it("refuses while agents of its organization list it, naming each in sorted order", async () => {
    await seedAgent(HELPER.id, HELPER.org, HELPER.slug);
    await seedAgent("agt_zeta", PARENT_ORG, "zeta", { subagents: [agentRef("helper")] });
    await seedAgent("agt_alpha", PARENT_ORG, "alpha", { subagents: [agentRef("helper", "")] });

    const error = await deleteAgent(HELPER);
    expect(error).toBeInstanceOf(ConnectError);
    expect((error as ConnectError).code).toBe(Code.FailedPrecondition);
    expect((error as ConnectError).rawMessage).toBe(
      "agent 'helper' is still used by agent 'alpha', agent 'zeta'; remove it from their subagents first",
    );
    expect(stillListedMessage(UNLISTED_AGENT, "helper", ["zeta", "alpha"])).toBe(
      (error as ConnectError).rawMessage,
    );
  });

  it("is not blocked by a child organization's agent that lists the parent's shared agent", async () => {
    await seedAgent(HELPER.id, HELPER.org, HELPER.slug);
    await seedAgent("agt_child_lister", CHILD_ORG, "lister", {
      subagents: [agentRef("helper", PARENT_ORG)],
    });
    expect(await deleteAgent(HELPER)).toBeUndefined();
  });

  it("is not blocked by an agent of another organization listing its own agent of the same slug", async () => {
    await seedAgent(HELPER.id, HELPER.org, HELPER.slug);
    await seedAgent("agt_child_helper", CHILD_ORG, "helper");
    await seedAgent("agt_child_lister", CHILD_ORG, "lister", { subagents: [agentRef("helper", CHILD_ORG)] });
    expect(await deleteAgent(HELPER)).toBeUndefined();
  });

  it("is not blocked by a same-slug reference of another kind", async () => {
    await seedAgent(HELPER.id, HELPER.org, HELPER.slug);
    await seedAgent("agt_lister", PARENT_ORG, "lister", {
      plugins: [{ kind: ApiResourceKind.plugin, org: PARENT_ORG, slug: "helper" }],
      skillRefs: [{ kind: ApiResourceKind.skill, org: PARENT_ORG, slug: "helper" }],
    });
    expect(await deleteAgent(HELPER)).toBeUndefined();
  });

  it("a chain that reached it without the loaded target is INTERNAL", async () => {
    const error = await deleteAgent(undefined);
    expect((error as ConnectError).code).toBe(Code.Internal);
  });

  it("a store that cannot list agents is INTERNAL, never a pass", async () => {
    const failing = {
      listResources: () => Promise.reject(new Error("disk gone")),
    } as unknown as Store;
    const error = await deleteAgent(HELPER, failing);
    expect((error as ConnectError).code).toBe(Code.Internal);
  });
});

describe("GuardUnlisted for a plugin", () => {
  it("keeps the plugin's sentence", async () => {
    await store.saveResource(
      ApiResourceKind.plugin,
      "plg_tools",
      PluginSchema,
      create(PluginSchema, { metadata: { id: "plg_tools", slug: "tools", name: "tools", org: PARENT_ORG } }),
    );
    await seedAgent("agt_user", PARENT_ORG, "user", {
      plugins: [{ kind: ApiResourceKind.plugin, org: PARENT_ORG, slug: "tools" }],
    });
    // An agent listing an agent of the plugin's slug is not a plugin listing.
    await seedAgent("agt_other", PARENT_ORG, "other", { subagents: [agentRef("tools")] });
    const ctx = new RequestContext(
      ApiResourceIdSchema,
      create(ApiResourceIdSchema, { value: "plg_tools" }),
      testCallerIdentity(),
      ApiResourceKind.plugin,
    );
    ctx.set(
      EXISTING_RESOURCE_KEY,
      create(PluginSchema, { metadata: { id: "plg_tools", slug: "tools", org: PARENT_ORG } }),
    );
    const error = await Promise.resolve()
      .then(() => newGuardUnlistedStep<typeof ApiResourceIdSchema>(store, UNLISTED_PLUGIN).execute(ctx))
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    expect((error as ConnectError).code).toBe(Code.FailedPrecondition);
    expect((error as ConnectError).rawMessage).toBe(
      "plugin 'tools' is still used by agent 'user'; remove it from their plugins first",
    );
  });
});
