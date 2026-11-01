// The manifest visibility rule, as the SDK's ManifestClient follows it (the
// console's YAML editors) and the CLI's `apply -f` calls it.
//
// An apply keeps the stored visibility (both editions), so a manifest that
// declares another level is followed with one `updateVisibility`, the only
// door that runs the server's level guards. A file that declares no level,
// or the stored one, costs no call; a kind with no door keeps its level and
// says so, before the apply (`resolveTarget`) and after it
// (`visibilityKept`); a refused change carries what the apply stored.
// Visibility lands before a rename, so a refused rename reports the level
// that landed.
//
// The documents are parsed from YAML and applied through the registry's
// own bindings over an in-memory router, so the binding a kind declares is
// the one under test.

import { describe, it, expect } from "vitest";
import { clone, create } from "@bufbuild/protobuf";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { AgentSchema, type Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentCommandController } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/command_pb";
import { AgentQueryController } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/query_pb";
import { ChannelSchema, type Channel } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/api_pb";
import { ChannelCommandController } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/command_pb";
import { ChannelQueryController } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/query_pb";
import { ApiResourceVisibility } from "@stigmer/apis/ai/stigmer/commons/apiresource/enum_pb";
import type { RenameInput, UpdateVisibilityInput } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";
import { getErrorReason } from "../errors";
import { ManifestClient } from "../manifest/client";
import { parseManifest } from "../manifest/parse";
import { SlugChangeRefusedError } from "../manifest/slug";
import { VisibilityChangeRefusedError } from "../manifest/visibility";
import { ErrorInfoSchema } from "@stigmer/apis/google/rpc/error_details_pb";

const { visibility_private: PRIVATE, visibility_org: ORG } = ApiResourceVisibility;

function storedAgent(slug: string, visibility: ApiResourceVisibility): Agent {
  return create(AgentSchema, {
    metadata: { id: "agt_1", name: "Support bot", slug, org: "acme", visibility },
    spec: { instructions: "Help customers" },
  });
}

function storedChannel(slug: string, visibility: ApiResourceVisibility): Channel {
  return create(ChannelSchema, {
    metadata: { id: "chn_1", name: "Support", slug, org: "acme", visibility },
  });
}

/** An agent document; `visibility` and `id` are written only when given. */
function agentYaml(opts: { slug: string; visibility?: string; id?: string }): string {
  return [
    "apiVersion: agentic.stigmer.ai/v1",
    "kind: Agent",
    "metadata:",
    ...(opts.id === undefined ? [] : [`  id: ${opts.id}`]),
    "  name: Support bot",
    `  slug: ${opts.slug}`,
    "  org: acme",
    ...(opts.visibility === undefined ? [] : [`  visibility: ${opts.visibility}`]),
    "spec:",
    "  instructions: Help customers",
  ].join("\n");
}

function channelYaml(opts: { slug: string; visibility: string; id?: string }): string {
  return [
    "apiVersion: agentic.stigmer.ai/v1",
    "kind: Channel",
    "metadata:",
    ...(opts.id === undefined ? [] : [`  id: ${opts.id}`]),
    "  name: Support",
    `  slug: ${opts.slug}`,
    "  org: acme",
    `  visibility: ${opts.visibility}`,
  ].join("\n");
}

interface Server {
  readonly client: ManifestClient;
  readonly visibilityCalls: UpdateVisibilityInput[];
  readonly renames: RenameInput[];
  /** The order the write RPCs ran in. */
  readonly writes: string[];
}

/**
 * A server holding one agent and one channel. Apply keeps the stored
 * visibility and slug and takes the spec, as both editions do;
 * `updateVisibility` answers with the stored resource at the new level.
 */
function server(opts: {
  agent?: Agent;
  channel?: Channel;
  refuseVisibility?: ConnectError;
  refuseRename?: ConnectError;
}): Server {
  const visibilityCalls: UpdateVisibilityInput[] = [];
  const renames: RenameInput[] = [];
  const writes: string[] = [];
  let agent = opts.agent ?? storedAgent("support-bot", PRIVATE);
  const channel = opts.channel ?? storedChannel("support", PRIVATE);
  const transport = createRouterTransport(({ service }) => {
    service(AgentCommandController, {
      apply: (req) => {
        writes.push("apply");
        agent = create(AgentSchema, { metadata: agent.metadata, spec: req.spec });
        return agent;
      },
      updateVisibility: (req) => {
        writes.push("updateVisibility");
        visibilityCalls.push(req);
        if (opts.refuseVisibility !== undefined) throw opts.refuseVisibility;
        agent = clone(AgentSchema, agent);
        agent.metadata!.visibility = req.visibility;
        return agent;
      },
      rename: (req) => {
        writes.push("rename");
        renames.push(req);
        if (opts.refuseRename !== undefined) throw opts.refuseRename;
        agent = clone(AgentSchema, agent);
        agent.metadata!.slug = req.slug;
        return agent;
      },
    });
    service(AgentQueryController, { getByReference: () => agent });
    service(ChannelCommandController, {
      apply: () => {
        writes.push("apply");
        return channel;
      },
      rename: (req) => {
        writes.push("rename");
        renames.push(req);
        const renamed = clone(ChannelSchema, channel);
        renamed.metadata!.slug = req.slug;
        return renamed;
      },
    });
    service(ChannelQueryController, { getByReference: () => channel });
  });
  return { client: new ManifestClient(transport), visibilityCalls, renames, writes };
}

function only(yaml: string) {
  const [doc] = parseManifest(yaml, { org: "acme" });
  return doc;
}

function visibilityOf(message: unknown): ApiResourceVisibility | undefined {
  return (message as Agent).metadata?.visibility;
}

describe("ManifestClient.apply lands a declared visibility", () => {
  it("follows an apply with one updateVisibility when the file declares another level, and returns the new level", async () => {
    const s = server({});

    const applied = await s.client.apply(only(agentYaml({ slug: "support-bot", visibility: "visibility_org" })));

    expect(s.visibilityCalls.map((c) => [c.resourceId, c.visibility])).toEqual([["agt_1", ORG]]);
    expect(visibilityOf(applied.message)).toBe(ORG);
    expect(applied.visibilityKept).toBe(false);
  });

  it("makes no call when the file declares the stored level, or none", async () => {
    const s = server({});

    const same = await s.client.apply(only(agentYaml({ slug: "support-bot", visibility: "visibility_private" })));
    const none = await s.client.apply(only(agentYaml({ slug: "support-bot" })));

    expect(s.visibilityCalls).toHaveLength(0);
    expect(same.visibilityKept).toBe(false);
    expect(none.visibilityKept).toBe(false);
    expect(visibilityOf(none.message)).toBe(PRIVATE);
  });

  it("keeps the level of a kind with no visibility door, says so, and makes no call", async () => {
    const s = server({});

    const applied = await s.client.apply(only(channelYaml({ slug: "support", visibility: "visibility_org" })));

    expect(applied.visibilityKept).toBe(true);
    expect(visibilityOf(applied.message)).toBe(PRIVATE);
    expect(s.writes).toEqual(["apply"]);
  });

  it("refuses with the applied resource when the change is refused, keeping the server's reason", async () => {
    const denied = new ConnectError("org visibility needs the org's admin", Code.PermissionDenied, undefined, [
      { desc: ErrorInfoSchema, value: create(ErrorInfoSchema, { reason: "VISIBILITY_DENIED", domain: "stigmer.ai" }) },
    ]);
    const s = server({ refuseVisibility: denied });

    const err = await s.client
      .apply(only(agentYaml({ slug: "support-bot", visibility: "visibility_org" })))
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(VisibilityChangeRefusedError);
    const refused = err as VisibilityChangeRefusedError;
    expect(visibilityOf(refused.applied)).toBe(PRIVATE);
    expect(refused.declaredVisibility).toBe(ORG);
    expect(refused.visibility).toBe(PRIVATE);
    expect(refused.code).toBe("permission-denied");
    expect(refused.message).toBe(
      "Agent spec applied, but the visibility change to 'visibility_org' was refused: " +
        "org visibility needs the org's admin. The visibility stays 'visibility_private'",
    );
    expect(getErrorReason(refused)?.reason).toBe("VISIBILITY_DENIED");
  });

  it("lands the visibility before a rename, so a refused rename's applied resource shows the new level", async () => {
    const s = server({ refuseRename: new ConnectError("slug taken", Code.AlreadyExists) });

    const err = await s.client
      .apply(only(agentYaml({ id: "agt_1", slug: "helpdesk-bot", visibility: "visibility_org" })))
      .catch((e: unknown) => e);

    expect(s.writes).toEqual(["apply", "updateVisibility", "rename"]);
    expect(err).toBeInstanceOf(SlugChangeRefusedError);
    expect(visibilityOf((err as SlugChangeRefusedError).applied)).toBe(ORG);
  });

  it("lands both a new level and a new slug", async () => {
    const s = server({});

    const applied = await s.client.apply(
      only(agentYaml({ id: "agt_1", slug: "helpdesk-bot", visibility: "visibility_org" })),
    );

    expect(applied.slug).toBe("helpdesk-bot");
    expect(applied.renamedFrom).toBe("support-bot");
    expect(visibilityOf(applied.message)).toBe(ORG);
  });
});

describe("ManifestClient.resolveTarget tells a kept visibility before the apply", () => {
  it("answers update with visibilityKept for a kind with no door and another declared level", async () => {
    const s = server({});

    const target = await s.client.resolveTarget(only(channelYaml({ slug: "support", visibility: "visibility_org" })));

    expect(target).toMatchObject({ action: "update", slug: "support", slugKept: false, visibilityKept: true });
  });

  it("answers rename with visibilityKept when a renamed kind cannot take the level either", async () => {
    const s = server({});

    const target = await s.client.resolveTarget(
      only(channelYaml({ id: "chn_1", slug: "helpdesk", visibility: "visibility_org" })),
    );

    expect(target).toMatchObject({ action: "rename", from: "support", slug: "helpdesk", visibilityKept: true });
  });

  it("answers visibilityKept false where the kind has the door, or the level does not change", async () => {
    const s = server({});

    const agent = await s.client.resolveTarget(only(agentYaml({ slug: "support-bot", visibility: "visibility_org" })));
    const channel = await s.client.resolveTarget(
      only(channelYaml({ slug: "support", visibility: "visibility_private" })),
    );

    expect(agent).toMatchObject({ action: "update", visibilityKept: false });
    expect(channel).toMatchObject({ action: "update", visibilityKept: false });
  });
});
