// Conformance suite for the Skill domain.
// Domain: agentic / skill — the second VERSIONED resource in the suite, and the
// first whose versioning is artifact-based rather than spec-based.
//
// Drives SkillCommandController + SkillQueryController through the raw proto
// stubs. Skill diverges sharply from Workflow/Agent:
//   - There is no create/apply/update/validateSpec. A skill is *pushed* as a ZIP
//     whose root SKILL.md carries YAML frontmatter; push is an upsert-by-slug.
//   - Identity is server-derived: metadata.name and metadata.slug both come from
//     the frontmatter `name` (the request carries no name). Backend is the single
//     source of truth.
//   - A version is the SHA-256 of the artifact *bytes*. So changing the artifact
//     body yields a new version, and re-pushing identical bytes is a no-op for
//     history. The version-history tests pull exactly that lever.
//   - Historical artifacts are retrieved in two steps: listVersions gives each
//     version's artifact_storage_key, which getArtifact downloads.
//
// No known deviations are expected: every user-reachable Skill path runs through
// ValidateProtoStep (or, for pushFromExecutionArtifact, equivalent manual checks)
// and returns correct gRPC codes — unlike Workflow's create pipeline.
import { SkillSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import { assertResourceParity } from "../contract/parity";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { uniqueName } from "../support/naming";
import { makeSkillArtifact, zipFiles } from "../support/skills";
import { createTarget, type TargetProfile } from "../targets";

let target: TargetProfile;
let clients: ConformanceClients;
const fixtures = new FixtureTracker();

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
});

afterEach(async () => {
  await fixtures.cleanup();
});

afterAll(async () => {
  await target?.teardown();
});

interface PushOptions {
  tag?: string;
  message?: string;
  // Push targets an existing skill by slug, so a second push of the same name
  // addresses the same resource. Only the first push in a sequence defers
  // cleanup; later pushes pass track=false to avoid re-registering the same id.
  track?: boolean;
}

async function pushSkill(org: string, artifact: Uint8Array, opts: PushOptions = {}) {
  const skill = await clients.skillCommand.push({ org, artifact, tag: opts.tag, message: opts.message });
  if (opts.track ?? true) {
    fixtures.defer(() => clients.skillCommand.delete({ value: skill.metadata!.id }));
  }
  return skill;
}

describe("Skill conformance — push & identity", () => {
  it("push assigns a skl_ id, derives name+slug from the artifact frontmatter, and computes a version hash", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("skill");

    // The request carries no name; the backend extracts it from SKILL.md.
    const pushed = await pushSkill(org, makeSkillArtifact({ name, description: "a conformance skill" }));

    expect(pushed.metadata?.id, "push should assign a prefixed id").toMatch(/^skl_[0-9a-z]+$/);
    expect(pushed.metadata?.name, "name is derived from frontmatter").toBe(name);
    expect(pushed.metadata?.slug, "slug equals the frontmatter name").toBe(name);
    expect(pushed.metadata?.org).toBe(org);
    expect(pushed.status?.versionHash, "push computes a SHA-256 content hash").toMatch(/^[a-f0-9]{64}$/);
    expect(pushed.status?.artifactStorageKey, "push records a content-addressable storage key").not.toBe("");
    // A pushed skill is private until explicitly made public.
    expect(pushed.metadata?.visibility, "visibility defaults to private").toBe(ApiResourceVisibility.visibility_private);
  });

  it("get round-trips the pushed skill (ignoring server-set fields)", async () => {
    const { org } = await target.provisionTenancy();
    const pushed = await pushSkill(org, makeSkillArtifact({ name: uniqueName("skill") }));

    const fetched = await clients.skillQuery.get({ value: pushed.metadata!.id });

    expect(fetched.metadata?.id).toBe(pushed.metadata?.id);
    assertResourceParity(SkillSchema, pushed, fetched, "push vs get");
  });

  it("getByReference resolves the latest version by org and slug", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("skill");
    const pushed = await pushSkill(org, makeSkillArtifact({ name }));

    const fetched = await clients.skillQuery.getByReference({ org, slug: name });

    expect(fetched.metadata?.id).toBe(pushed.metadata?.id);
    expect(fetched.status?.versionHash).toBe(pushed.status?.versionHash);
  });

  it("isolates skills with the same name across orgs", async () => {
    const a = await target.provisionTenancy();
    const b = await target.provisionTenancy();
    const name = uniqueName("shared");

    // Identical bytes in two orgs: content-addressable storage may dedup the
    // bytes, but the two skills are distinct, independently-addressable resources.
    const artifact = makeSkillArtifact({ name });
    const inA = await pushSkill(a.org, artifact);
    const inB = await pushSkill(b.org, artifact);

    expect(inA.metadata?.slug).toBe(inB.metadata?.slug);
    expect(inA.metadata?.id, "the same name in different orgs yields distinct skills").not.toBe(inB.metadata?.id);

    const fromA = await clients.skillQuery.getByReference({ org: a.org, slug: name });
    const fromB = await clients.skillQuery.getByReference({ org: b.org, slug: name });
    expect(fromA.metadata?.id).toBe(inA.metadata?.id);
    expect(fromB.metadata?.id).toBe(inB.metadata?.id);
  });

  it("get rejects an empty id with InvalidArgument", () =>
    expectGrpcCode(() => clients.skillQuery.get({ value: "" }), Code.InvalidArgument, "get empty id"));

  it("get of a missing id returns NotFound", () =>
    expectGrpcCode(() => clients.skillQuery.get({ value: "skl_doesnotexist" }), Code.NotFound, "get missing id"));
});

describe("Skill conformance — push validation negatives", () => {
  it("rejects a push with no org (InvalidArgument)", async () => {
    await expectGrpcCode(
      () => clients.skillCommand.push({ org: "", artifact: makeSkillArtifact({ name: uniqueName("skill") }) }),
      Code.InvalidArgument,
      "push without org",
    );
  });

  it("rejects an empty artifact (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(
      () => clients.skillCommand.push({ org, artifact: new Uint8Array() }),
      Code.InvalidArgument,
      "push empty artifact",
    );
  });

  it("rejects a non-ZIP artifact (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(
      () => clients.skillCommand.push({ org, artifact: new Uint8Array([1, 2, 3, 4]) }),
      Code.InvalidArgument,
      "push non-zip bytes",
    );
  });

  it("rejects a ZIP without SKILL.md (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(
      () => clients.skillCommand.push({ org, artifact: zipFiles({ "README.md": "# not a skill file" }) }),
      Code.InvalidArgument,
      "push zip missing SKILL.md",
    );
  });

  it("rejects a SKILL.md with no YAML frontmatter (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(
      () => clients.skillCommand.push({ org, artifact: zipFiles({ "SKILL.md": "# Just a heading, no frontmatter" }) }),
      Code.InvalidArgument,
      "push SKILL.md without frontmatter",
    );
  });

  it("rejects a frontmatter name that is not kebab-case (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    // "Not Kebab" violates ^[a-z0-9]+(-[a-z0-9]+)*$ (uppercase + spaces).
    await expectGrpcCode(
      () =>
        clients.skillCommand.push({
          org,
          artifact: zipFiles({ "SKILL.md": "---\nname: Not Kebab\n---\n# body" }),
        }),
      Code.InvalidArgument,
      "push non-kebab frontmatter name",
    );
  });
});

describe("Skill conformance — version history", () => {
  it("re-pushing identical bytes does not archive a new version", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("skill");

    // Reusing the exact same buffer guarantees an identical version hash, so the
    // second push is a content no-op and must not add a history entry.
    const artifact = makeSkillArtifact({ name, body: "# v1" });
    const first = await pushSkill(org, artifact);
    await pushSkill(org, artifact, { track: false });

    const history = await clients.skillQuery.listVersions({ org, slug: name });
    expect(history.versions, "re-pushing the same bytes must not create a version").toHaveLength(1);
    expect(history.totalCount).toBe(1);
    expect(history.versions[0]?.versionHash).toBe(first.status?.versionHash);
  });

  it("pushing changed content archives a new version (newest-first, exactly one current)", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("skill");

    const v1 = await pushSkill(org, makeSkillArtifact({ name, body: "# v1" }));
    const v2 = await pushSkill(org, makeSkillArtifact({ name, body: "# v2 changed" }), { track: false });

    expect(v2.metadata?.id, "a new version updates the same skill").toBe(v1.metadata?.id);
    expect(v2.status?.versionHash).not.toBe(v1.status?.versionHash);

    const history = await clients.skillQuery.listVersions({ org, slug: name });
    expect(history.versions).toHaveLength(2);
    expect(history.totalCount).toBe(2);

    // Newest first; the head is current and matches the live skill's hash.
    expect(history.versions[0]?.isCurrent).toBe(true);
    expect(history.versions[0]?.versionHash).toBe(v2.status?.versionHash);
    expect(history.versions.filter((entry) => entry.isCurrent)).toHaveLength(1);
    for (const entry of history.versions) {
      expect(entry.artifactStorageKey, "each version carries its artifact storage key").not.toBe("");
    }
  });
});

describe("Skill conformance — getByReference resolution", () => {
  it("resolves latest, an exact hash, and a push-time tag", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("skill");

    // v1 carries a push-time tag; v2 (untagged) becomes the head.
    const v1 = await pushSkill(org, makeSkillArtifact({ name, body: "# v1" }), { tag: "stable" });
    const v2 = await pushSkill(org, makeSkillArtifact({ name, body: "# v2" }), { track: false });

    const latest = await clients.skillQuery.getByReference({ org, slug: name });
    expect(latest.status?.versionHash, "empty version resolves to the head").toBe(v2.status?.versionHash);

    const explicitLatest = await clients.skillQuery.getByReference({ org, slug: name, version: "latest" });
    expect(explicitLatest.status?.versionHash, '"latest" resolves to the head').toBe(v2.status?.versionHash);

    const byHash = await clients.skillQuery.getByReference({ org, slug: name, version: v1.status!.versionHash });
    expect(byHash.status?.versionHash, "a 64-hex version resolves to the exact archived version").toBe(
      v1.status?.versionHash,
    );

    const byTag = await clients.skillQuery.getByReference({ org, slug: name, version: "stable" });
    expect(byTag.status?.versionHash, "a push-time tag resolves to the version it tagged").toBe(v1.status?.versionHash);
  });

  it("treats an uppercase 64-hex version as a tag and returns NotFound", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("skill");
    const v1 = await pushSkill(org, makeSkillArtifact({ name }));

    // Hash detection is strict lowercase hex; an uppercased hash is interpreted
    // as a tag (which does not exist), not as the version it spells.
    const upper = v1.status!.versionHash.toUpperCase();
    await expectGrpcCode(
      () => clients.skillQuery.getByReference({ org, slug: name, version: upper }),
      Code.NotFound,
      "uppercase hash treated as tag",
    );
  });

  it("returns NotFound for a well-formed but unknown version", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("skill");
    await pushSkill(org, makeSkillArtifact({ name }));

    await expectGrpcCode(
      () => clients.skillQuery.getByReference({ org, slug: name, version: "0".repeat(64) }),
      Code.NotFound,
      "getByReference unknown hash",
    );
  });

  it("rejects a reference without a slug (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(
      () => clients.skillQuery.getByReference({ org, slug: "" }),
      Code.InvalidArgument,
      "getByReference empty slug",
    );
  });

  it("returns NotFound for an unknown slug", async () => {
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(
      () => clients.skillQuery.getByReference({ org, slug: "does-not-exist" }),
      Code.NotFound,
      "getByReference unknown slug",
    );
  });
});

describe("Skill conformance — artifact download (getArtifact)", () => {
  it("returns the exact bytes that were pushed", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("skill");
    const artifact = makeSkillArtifact({ name, body: "# downloadable" });
    const pushed = await pushSkill(org, artifact);

    const res = await clients.skillQuery.getArtifact({ artifactStorageKey: pushed.status!.artifactStorageKey });

    expect(Buffer.from(res.artifact).equals(Buffer.from(artifact)), "getArtifact returns the pushed ZIP verbatim").toBe(
      true,
    );
  });

  it("downloads a historical version's artifact via its storage key", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("skill");
    const v1Bytes = makeSkillArtifact({ name, body: "# v1" });
    const v1 = await pushSkill(org, v1Bytes);
    await pushSkill(org, makeSkillArtifact({ name, body: "# v2" }), { track: false });

    const history = await clients.skillQuery.listVersions({ org, slug: name });
    const v1Entry = history.versions.find((entry) => entry.versionHash === v1.status!.versionHash);
    expect(v1Entry, "v1 remains in the version history after v2 is pushed").toBeDefined();

    const res = await clients.skillQuery.getArtifact({ artifactStorageKey: v1Entry!.artifactStorageKey });
    expect(
      Buffer.from(res.artifact).equals(Buffer.from(v1Bytes)),
      "the historical artifact is byte-identical to the v1 push",
    ).toBe(true);
  });

  it("rejects an empty storage key (InvalidArgument)", async () => {
    await expectGrpcCode(
      () => clients.skillQuery.getArtifact({ artifactStorageKey: "" }),
      Code.InvalidArgument,
      "getArtifact empty key",
    );
  });

  it("returns NotFound for an unknown storage key", async () => {
    await expectGrpcCode(
      () => clients.skillQuery.getArtifact({ artifactStorageKey: "skills/0000000000000000000000000000000000000000000000000000000000000000.zip" }),
      Code.NotFound,
      "getArtifact unknown key",
    );
  });

  it("does not traverse outside the artifact store for a path-traversal key", async () => {
    // The exact code for a malformed key is implementation-defined (NotFound or
    // Internal); the contract is only that it never succeeds and never escapes
    // the store to return foreign content.
    let thrown: ConnectError | undefined;
    try {
      await clients.skillQuery.getArtifact({ artifactStorageKey: "../../../../etc/passwd" });
    } catch (err) {
      thrown = ConnectError.from(err);
    }
    expect(thrown, "a path-traversal key must not succeed").toBeDefined();
    expect([Code.NotFound, Code.Internal]).toContain(thrown!.code);
  });
});

describe("Skill conformance — listVersions", () => {
  it("rejects a missing org (InvalidArgument)", async () => {
    await expectGrpcCode(
      () => clients.skillQuery.listVersions({ org: "", slug: "anything" }),
      Code.InvalidArgument,
      "listVersions missing org",
    );
  });

  it("rejects a missing slug (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(
      () => clients.skillQuery.listVersions({ org, slug: "" }),
      Code.InvalidArgument,
      "listVersions missing slug",
    );
  });

  it("returns NotFound for an unknown skill", async () => {
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(
      () => clients.skillQuery.listVersions({ org, slug: "does-not-exist" }),
      Code.NotFound,
      "listVersions unknown skill",
    );
  });

  it("paginates version history newest-first", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("skill");

    const v1 = await pushSkill(org, makeSkillArtifact({ name, body: "# v1" }));
    const v2 = await pushSkill(org, makeSkillArtifact({ name, body: "# v2" }), { track: false });
    const v3 = await pushSkill(org, makeSkillArtifact({ name, body: "# v3" }), { track: false });

    const page1 = await clients.skillQuery.listVersions({ org, slug: name, pageSize: 2 });
    expect(page1.versions).toHaveLength(2);
    expect(page1.totalCount).toBe(3);
    expect(page1.nextPageToken, "a partial page yields a continuation token").not.toBe("");
    expect(page1.versions[0]?.versionHash).toBe(v3.status?.versionHash);
    expect(page1.versions[1]?.versionHash).toBe(v2.status?.versionHash);

    const page2 = await clients.skillQuery.listVersions({ org, slug: name, pageSize: 2, pageToken: page1.nextPageToken });
    expect(page2.versions).toHaveLength(1);
    expect(page2.versions[0]?.versionHash).toBe(v1.status?.versionHash);
    expect(page2.nextPageToken, "the final page has no continuation token").toBe("");
  });

  it("rejects a malformed page token (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("skill");
    await pushSkill(org, makeSkillArtifact({ name }));

    await expectGrpcCode(
      () => clients.skillQuery.listVersions({ org, slug: name, pageToken: "@@@not-a-valid-token@@@" }),
      Code.InvalidArgument,
      "listVersions malformed page token",
    );
  });

  it("maps version entry fields (hash, storage key, pushed_at, tag, message)", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("skill");
    const v1 = await pushSkill(org, makeSkillArtifact({ name }), { tag: "stable", message: "initial release" });

    const history = await clients.skillQuery.listVersions({ org, slug: name });
    const entry = history.versions[0];

    expect(entry?.versionHash).toBe(v1.status?.versionHash);
    expect(entry?.artifactStorageKey).toBe(v1.status?.artifactStorageKey);
    expect(entry?.pushedAt, "a version records when it was pushed").toBeDefined();
    expect(entry?.tag).toBe("stable");
    expect(entry?.message).toBe("initial release");
    expect(entry?.isCurrent).toBe(true);
  });
});

describe("Skill conformance — updateVisibility", () => {
  it("flips a private skill to public", async () => {
    const { org } = await target.provisionTenancy();
    const pushed = await pushSkill(org, makeSkillArtifact({ name: uniqueName("skill") }));
    expect(pushed.metadata?.visibility).toBe(ApiResourceVisibility.visibility_private);

    const updated = await clients.skillCommand.updateVisibility({
      resourceId: pushed.metadata!.id,
      visibility: ApiResourceVisibility.visibility_public,
    });
    expect(updated.metadata?.visibility).toBe(ApiResourceVisibility.visibility_public);

    // The change is durable and observable via a fresh read.
    const fetched = await clients.skillQuery.get({ value: pushed.metadata!.id });
    expect(fetched.metadata?.visibility).toBe(ApiResourceVisibility.visibility_public);
  });

  it("returns NotFound for an unknown skill", async () => {
    await expectGrpcCode(
      () =>
        clients.skillCommand.updateVisibility({
          resourceId: "skl_doesnotexist",
          visibility: ApiResourceVisibility.visibility_public,
        }),
      Code.NotFound,
      "updateVisibility unknown id",
    );
  });
});

describe("Skill conformance — delete", () => {
  it("delete returns the skill and removes it from get, getByReference, and listVersions", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("skill");
    // Push without the deferred-cleanup helper: this test deletes the skill
    // itself, so a deferred delete would just no-op against an absent resource.
    const pushed = await clients.skillCommand.push({ org, artifact: makeSkillArtifact({ name }) });
    const { id } = pushed.metadata!;

    const deleted = await clients.skillCommand.delete({ value: id });
    expect(deleted.metadata?.id).toBe(id);

    // Note: in OSS the content-addressable artifact ZIP intentionally remains on
    // disk after delete (getArtifact by storage key still works). That is an OSS
    // storage detail, not part of the shared cross-edition contract, so it is
    // documented here but deliberately not asserted.
    await expectGrpcCode(() => clients.skillQuery.get({ value: id }), Code.NotFound, "get after delete");
    await expectGrpcCode(
      () => clients.skillQuery.getByReference({ org, slug: name }),
      Code.NotFound,
      "getByReference after delete",
    );
    await expectGrpcCode(
      () => clients.skillQuery.listVersions({ org, slug: name }),
      Code.NotFound,
      "listVersions after delete",
    );
  });

  it("delete of a missing id returns NotFound", () =>
    expectGrpcCode(() => clients.skillCommand.delete({ value: "skl_doesnotexist" }), Code.NotFound, "delete missing id"));

  it("delete rejects an empty id with InvalidArgument", () =>
    expectGrpcCode(() => clients.skillCommand.delete({ value: "" }), Code.InvalidArgument, "delete empty id"));
});

describe("Skill conformance — pushFromExecutionArtifact (input validation)", () => {
  // pushFromExecutionArtifact is a DIRECT handler: it does not run through the
  // request pipeline, so protovalidate never executes. It instead performs its
  // own ordered manual checks and — unlike Workflow's getVersion — returns the
  // correct gRPC codes, so there is no deviation to register here.
  //
  // The happy path requires a real execution artifact already present in the
  // server's execution-artifact storage (produced by an agent execution). The
  // harness owns the server's temp dir and does not expose it, so seeding one is
  // not possible from a black-box client; the happy path is intentionally
  // covered at the integration layer, not here. The manual validation checks,
  // however, run before any storage access and are fully reachable.

  it("rejects an empty execution_id (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(
      () =>
        clients.skillCommand.pushFromExecutionArtifact({
          org,
          executionId: "",
          storageKey: "artifacts/aex_example/skill.zip",
        }),
      Code.InvalidArgument,
      "pushFromExecutionArtifact empty execution_id",
    );
  });

  it("rejects an empty storage_key (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(
      () => clients.skillCommand.pushFromExecutionArtifact({ org, executionId: "aex_example", storageKey: "" }),
      Code.InvalidArgument,
      "pushFromExecutionArtifact empty storage_key",
    );
  });

  it("rejects an empty org (InvalidArgument)", async () => {
    await expectGrpcCode(
      () =>
        clients.skillCommand.pushFromExecutionArtifact({
          org: "",
          executionId: "aex_example",
          storageKey: "artifacts/aex_example/skill.zip",
        }),
      Code.InvalidArgument,
      "pushFromExecutionArtifact empty org",
    );
  });

  it("rejects a storage_key that does not belong to the execution (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    // The key must be prefixed "artifacts/<execution_id>/"; a key naming a
    // different execution is rejected as a path-traversal attempt.
    await expectGrpcCode(
      () =>
        clients.skillCommand.pushFromExecutionArtifact({
          org,
          executionId: "aex_example",
          storageKey: "artifacts/aex_other/skill.zip",
        }),
      Code.InvalidArgument,
      "pushFromExecutionArtifact storage_key prefix guard",
    );
  });
});
