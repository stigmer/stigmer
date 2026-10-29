import { describe, it, expect } from "vitest";
import { create, type Message } from "@bufbuild/protobuf";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { AgentSchema, type Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ApiResourceReference, RenameInput } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";
import { ErrorInfoSchema } from "@stigmer/apis/google/rpc/error_details_pb";
import { getErrorReason, StigmerError } from "../errors";
import { ManifestClient } from "../manifest/client";
import type { ManifestDocument } from "../manifest/parse";
import { parseManifest } from "../manifest/parse";
import { manifestHandlerForYamlKind, type ManifestKindHandler } from "../manifest/registry";
import { toDesiredState } from "../manifest/serialize";
import { SlugChangeRefusedError, SlugRenamedError } from "../manifest/slug";

/**
 * The manifest slug rules, as the SDK's ManifestClient follows them (the
 * console's YAML editors) and the CLI's `apply -f` calls them.
 *
 * Pins: a manifest carrying the resource's id and a new slug is renamed
 * after the apply, and one without the id is not; a kind with no rename
 * keeps its slug and says so; a refused rename carries what landed; a
 * renamed-away slug is answered with the current one; `resolveTarget`
 * answers create, update, rename or a kept slug by the apply's own lookup;
 * and a parsed file is a desired state (no etag, references by slug).
 */

const AGENT = manifestHandlerForYamlKind("Agent")!;

function agent(slug: string, id = "agt_1"): Agent {
  return create(AgentSchema, {
    metadata: { id, name: "Support bot", slug, org: "acme" },
    spec: { instructions: "Help customers" },
  });
}

interface Fake {
  readonly handler: ManifestKindHandler;
  readonly renames: RenameInput[];
  readonly reads: ApiResourceReference[];
}

function fakeHandler(opts: {
  base?: ManifestKindHandler;
  apply?: (message: Message) => Promise<Message>;
  rename?: ((input: RenameInput) => Promise<Message>) | null;
  read?: (ref: ApiResourceReference) => Promise<Message>;
}): Fake {
  const renames: RenameInput[] = [];
  const reads: ApiResourceReference[] = [];
  const base = opts.base ?? AGENT;
  const { rename: _baseRename, ...rest } = base;
  void _baseRename;
  const handler: ManifestKindHandler = {
    ...rest,
    apply: (_c, m) => (opts.apply ?? ((x) => Promise.resolve(x)))(m),
    getByReference: (_c, ref) => {
      reads.push(ref);
      return (opts.read ?? (() => Promise.reject(new ConnectError("not found", Code.NotFound))))(ref);
    },
    ...(opts.rename !== null && {
      rename: (_c, input) => {
        renames.push(input);
        return (opts.rename ?? ((i) => Promise.resolve(agent(i.slug))))(input);
      },
    }),
  };
  return { handler, renames, reads };
}

function documentOf(handler: ManifestKindHandler, message: Agent): ManifestDocument {
  const metadata = message.metadata!;
  return { handler, message, name: metadata.name, slug: metadata.slug || metadata.name, org: metadata.org };
}

const client = () => new ManifestClient(createRouterTransport(() => {}));

function slugRenamed(slug: string): ConnectError {
  return new ConnectError(`Agent '${slug}' was renamed`, Code.FailedPrecondition, undefined, [
    { desc: ErrorInfoSchema, value: create(ErrorInfoSchema, { reason: "SLUG_RENAMED", domain: "stigmer.ai", metadata: { slug } }) },
  ]);
}

describe("ManifestClient.apply follows the declared slug", () => {
  it("renames a resource whose manifest carries its id and a new slug, and returns it renamed", async () => {
    const fake = fakeHandler({ apply: () => Promise.resolve(agent("test-bot")) });

    const applied = await client().apply(documentOf(fake.handler, agent("support-bot")));

    expect(fake.renames.map((r) => [r.resourceId, r.slug])).toEqual([["agt_1", "support-bot"]]);
    expect(applied.slug).toBe("support-bot");
    expect(applied.renamedFrom).toBe("test-bot");
    expect(applied.slugKept).toBe(false);
  });

  it("does not rename when the manifest has no id (its slug is how apply finds it) or names the stored slug", async () => {
    const fake = fakeHandler({ apply: (m) => Promise.resolve(m) });

    const unnamed = await client().apply(documentOf(fake.handler, agent("support-bot", "")));
    const same = await client().apply(documentOf(fake.handler, agent("support-bot")));

    expect(fake.renames).toHaveLength(0);
    expect(unnamed.renamedFrom).toBeUndefined();
    expect(same.slugKept).toBe(false);
  });

  it("reports a kept slug on a kind with no rename, and the spec still lands", async () => {
    // Every registered kind has a rename today; the fake without one
    // stands for the kind that has none.
    const fake = fakeHandler({ rename: null, apply: () => Promise.resolve(agent("test-share")) });

    const applied = await client().apply(documentOf(fake.handler, agent("new-share")));

    expect(applied.slug).toBe("test-share");
    expect(applied.slugKept).toBe(true);
    expect(applied.renamedFrom).toBeUndefined();
  });

  it("refuses with the applied resource when the rename is refused, keeping the server's reason", async () => {
    const taken = new ConnectError("slug taken", Code.AlreadyExists, undefined, [
      { desc: ErrorInfoSchema, value: create(ErrorInfoSchema, { reason: "SLUG_RESERVED", domain: "stigmer.ai" }) },
    ]);
    const stored = agent("test-bot");
    const fake = fakeHandler({ apply: () => Promise.resolve(stored), rename: () => Promise.reject(taken) });

    const err = await client().apply(documentOf(fake.handler, agent("support-bot"))).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(SlugChangeRefusedError);
    const refused = err as SlugChangeRefusedError;
    expect(refused.applied).toBe(stored);
    expect(refused.declaredSlug).toBe("support-bot");
    expect(refused.slug).toBe("test-bot");
    expect(refused.code).toBe("already-exists");
    expect(refused.message).toBe(
      "Agent spec applied, but the rename to 'support-bot' was refused: slug taken. The slug stays 'test-bot'",
    );
    expect(getErrorReason(refused)?.reason).toBe("SLUG_RESERVED");
  });
});

describe("ManifestClient.apply on a renamed-away slug", () => {
  it("names the slug the resource has now, read as the caller by the old slug", async () => {
    const fake = fakeHandler({
      apply: () => Promise.reject(slugRenamed("test-bot")),
      read: () => Promise.resolve(agent("support-bot")),
    });

    const err = await client().apply(documentOf(fake.handler, agent("test-bot", ""))).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(SlugRenamedError);
    expect((err as SlugRenamedError).slug).toBe("test-bot");
    expect((err as SlugRenamedError).currentSlug).toBe("support-bot");
    expect((err as Error).message).toBe(
      "Agent 'test-bot' was renamed to 'support-bot'; set metadata.slug to 'support-bot' and apply again",
    );
    expect(fake.reads[0]).toMatchObject({ kind: ApiResourceKind.agent, org: "acme", slug: "test-bot" });
    expect(getErrorReason(err)?.reason).toBe("SLUG_RENAMED");
  });

  it("gives the server's refusal to a caller who may not read the resource", async () => {
    const fake = fakeHandler({
      apply: () => Promise.reject(slugRenamed("test-bot")),
      read: () => Promise.reject(new ConnectError("denied", Code.PermissionDenied)),
    });

    const err = await client().apply(documentOf(fake.handler, agent("test-bot", ""))).catch((e: unknown) => e);

    expect(err).not.toBeInstanceOf(SlugRenamedError);
    expect((err as StigmerError).code).toBe("failed-precondition");
  });
});

describe("ManifestClient.apply passes other refusals through", () => {
  it("leaves a refusal that is not SLUG_RENAMED as it is, reading nothing", async () => {
    const fake = fakeHandler({ apply: () => Promise.reject(new ConnectError("slug taken", Code.AlreadyExists)) });

    const err = await client().apply(documentOf(fake.handler, agent("support-bot", ""))).catch((e: unknown) => e);

    expect((err as StigmerError).code).toBe("already-exists");
    expect(err).not.toBeInstanceOf(SlugRenamedError);
    expect(fake.reads).toHaveLength(0);
  });

  it("gives the server's refusal when the read finds the slug the manifest names, or no slug", async () => {
    for (const found of ["test-bot", ""]) {
      const fake = fakeHandler({
        apply: () => Promise.reject(slugRenamed("test-bot")),
        read: () => Promise.resolve(agent(found)),
      });

      const err = await client().apply(documentOf(fake.handler, agent("test-bot", ""))).catch((e: unknown) => e);

      expect(err, `read answered '${found}'`).not.toBeInstanceOf(SlugRenamedError);
      expect((err as StigmerError).code).toBe("failed-precondition");
    }
  });
});

describe("ManifestClient.resolveTarget", () => {
  it("answers create when neither the id nor the slug finds a resource", async () => {
    const fake = fakeHandler({});

    const target = await client().resolveTarget(documentOf(fake.handler, agent("support-bot")));

    expect(target).toEqual({ action: "create", slug: "support-bot" });
    expect(fake.reads.map((r) => [r.id, r.slug])).toEqual([["agt_1", ""], ["", "support-bot"]]);
  });

  it("answers update for a resource found by its id under the declared slug", async () => {
    const stored = agent("test-bot");
    const fake = fakeHandler({ read: () => Promise.resolve(stored) });

    const target = await client().resolveTarget(documentOf(fake.handler, agent("test-bot")));

    expect(target).toEqual({ action: "update", slug: "test-bot", current: stored, slugKept: false });
  });

  it("answers rename from the stored slug when the id finds a resource the manifest names otherwise", async () => {
    const stored = agent("test-bot");
    const fake = fakeHandler({ read: () => Promise.resolve(stored) });

    const target = await client().resolveTarget(documentOf(fake.handler, agent("support-bot")));

    expect(target).toEqual({ action: "rename", from: "test-bot", slug: "support-bot", current: stored });
  });

  it("answers update with a kept slug on a kind with no rename", async () => {
    const stored = agent("test-share");
    const fake = fakeHandler({ rename: null, read: () => Promise.resolve(stored) });

    const target = await client().resolveTarget(documentOf(fake.handler, agent("new-share")));

    expect(target).toEqual({ action: "update", slug: "test-share", current: stored, slugKept: true });
  });

  it("finds a manifest without an id by its slug", async () => {
    const stored = agent("support-bot");
    const fake = fakeHandler({ read: () => Promise.resolve(stored) });

    const target = await client().resolveTarget(documentOf(fake.handler, agent("support-bot", "")));

    expect(target).toEqual({ action: "update", slug: "support-bot", current: stored, slugKept: false });
    expect(fake.reads).toHaveLength(1);
  });

  it("refuses, as the apply would, a manifest without an id that names a renamed-away slug", async () => {
    const fake = fakeHandler({ read: () => Promise.resolve(agent("support-bot")) });

    const err = await client().resolveTarget(documentOf(fake.handler, agent("test-bot", ""))).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(SlugRenamedError);
    expect((err as SlugRenamedError).currentSlug).toBe("support-bot");
  });

  it("passes on a failed read other than not-found", async () => {
    const fake = fakeHandler({ read: () => Promise.reject(new ConnectError("down", Code.Unavailable)) });

    const err = await client().resolveTarget(documentOf(fake.handler, agent("support-bot"))).catch((e: unknown) => e);

    expect((err as StigmerError).code).toBe("unavailable");
  });
});

describe("a file is a desired state", () => {
  it("toDesiredState drops the etag and the ids of references named by slug, and keeps the resource's id", () => {
    const read = create(AgentSchema, {
      metadata: { id: "agt_1", name: "Support bot", slug: "support-bot", org: "acme", etag: "e1" },
      spec: {
        skillRefs: [
          { kind: ApiResourceKind.skill, org: "acme", slug: "refunds", id: "skl_1" },
          { kind: ApiResourceKind.skill, id: "skl_gone" },
        ],
      },
    });

    const desired = toDesiredState(AgentSchema, read);

    expect(desired.metadata?.etag).toBe("");
    expect(desired.metadata?.id).toBe("agt_1");
    expect(desired.spec?.skillRefs.map((r) => [r.slug, r.id])).toEqual([["refunds", ""], ["", "skl_gone"]]);
    expect(read.metadata?.etag).toBe("e1");
  });

  it("parseManifest applies it, so a file printed by a full read is not a freshness check", () => {
    const [doc] = parseManifest(
      [
        "apiVersion: agentic.stigmer.ai/v1",
        "kind: Agent",
        "metadata:",
        "  id: agt_1",
        "  name: Support bot",
        "  slug: support-bot",
        "  org: acme",
        "  etag: e1",
        "spec:",
        "  skill_refs:",
        "    - { kind: skill, org: acme, slug: refunds, id: skl_1 }",
      ].join("\n"),
    );

    const parsed = doc.message as Agent;
    expect(parsed.metadata?.etag).toBe("");
    expect(parsed.spec?.skillRefs[0].id).toBe("");
    expect(parsed.spec?.skillRefs[0].slug).toBe("refunds");
  });
});
