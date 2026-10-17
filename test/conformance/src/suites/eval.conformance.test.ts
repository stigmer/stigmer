// Conformance suite for the Eval domain.
// Domain: agentic / eval — an agent's test cases, kept as their own thing:
// an evals/ folder in Claude Code's plugin-eval format, pushed whole under a
// slug the push names, versioned by the archive's digest. The contract
// pinned here, on every edition:
//   - a push of the working agent's folder creates the eval with its cases,
//     their tags and the servers its mocks stand in for in its status;
//   - a re-push of the same bytes returns the eval unchanged; a re-push
//     naming a tag moves the tag and adds no version; a changed folder is a
//     second version, with its message, in the history;
//   - the version ladder reads it by tag and by digest;
//   - a download, inline and over the transfer lane, is the bytes that were
//     pushed, at the head and at an older version; a push staged through an
//     upload URL is the same eval as an inline one;
//   - the organization's list holds it, and updateVisibility re-levels it,
//     refusing a level the kind does not support (child organizations);
//   - an archive that is not a zip, a folder where no case loads and the tag
//     `latest` are refused before any write;
//   - delete removes it, and a read then answers NotFound.
//
// Out of scope here: renaming (rename.conformance.test.ts, the renamable
// kinds' table), who may push, read and download (the eval cells of
// role-enforcement.conformance.test.ts, on the enforcing lane), and running
// an eval, which no RPC of this kind does.
import { Code } from "@connectrpc/connect";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/apis/ai/stigmer/commons/apiresource/enum_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import {
  digestOf,
  evalArchive,
  oneCaseEvalArchive,
  WORKING_AGENT_EVAL_CASES,
  workingAgentEvalFiles,
} from "../support/evals";
import { uniqueName } from "../support/naming";
import { createTarget, type TargetProfile } from "../targets";
import type { TenancyContext } from "../targets/target";

let target: TargetProfile;
let clients: ConformanceClients;
let tenancy: TenancyContext;
const fixtures = new FixtureTracker();

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
  tenancy = await target.provisionTenancy();
});

afterEach(async () => {
  await fixtures.cleanup();
});

afterAll(async () => {
  if (tenancy !== undefined) {
    await target.cleanupTenancy(tenancy);
  }
  await target?.teardown();
});

function org(): string {
  return tenancy.org;
}

function ref(slug: string, version = "") {
  return { org: org(), kind: ApiResourceKind.eval, slug, version };
}

/** Pushes `archive` under `slug`, deleted at the end of the test. */
async function push(
  slug: string,
  archive: Uint8Array,
  opts: { tag?: string; message?: string; visibility?: ApiResourceVisibility } = {},
) {
  const pushed = await clients.evalCommand.push({ org: org(), slug, artifact: archive, ...opts });
  fixtures.defer(() =>
    clients.evalCommand.delete({ value: pushed.metadata!.id }).then(
      () => undefined,
      () => undefined,
    ),
  );
  return pushed;
}

/** The working agent's folder, with one case's prompt changed when `change` is given. */
function workingAgentArchive(change?: string): Uint8Array {
  const files = workingAgentEvalFiles();
  if (change !== undefined) {
    files["repo-question/notes.md"] = new TextEncoder().encode(change);
  }
  return evalArchive(files);
}

describe("Eval conformance — push and versions", () => {
  it("[rpc:EvalCommandController.push] [rpc:EvalQueryController.get] pushes the working agent's evals/ folder as an eval: its cases, their tags and its mocked servers", async () => {
    const slug = uniqueName("evs-working");
    const archive = workingAgentArchive();
    const pushed = await push(slug, archive, { message: "first push" });

    expect(pushed.kind).toBe("Eval");
    expect(pushed.metadata?.id).toMatch(/^evs_/);
    expect(pushed.metadata?.slug).toBe(slug);
    expect(pushed.metadata?.name).toBe(slug);
    expect(pushed.metadata?.visibility).toBe(ApiResourceVisibility.visibility_org);
    expect(pushed.metadata?.version?.id).toBe(digestOf(archive));
    expect(pushed.metadata?.version?.message).toBe("first push");
    const status = pushed.status!;
    expect(status.digest).toBe(digestOf(archive));
    expect(status.caseCount).toBe(WORKING_AGENT_EVAL_CASES.length);
    expect(status.cases.map((c) => c.caseName)).toEqual([...WORKING_AGENT_EVAL_CASES]);
    expect(status.caseTags).toEqual(["quality"]);
    expect(status.findings).toEqual([]);
    expect(status.mockServers).toEqual(["orders-api"]);

    const got = await clients.evalQuery.get({ value: pushed.metadata!.id });
    expect(got.status?.digest).toBe(status.digest);
  });

  it("[rpc:EvalCommandController.push] [rpc:EvalQueryController.listVersions] returns the eval unchanged for the same bytes, moves a tag without a version, and records a changed folder as a second version", async () => {
    const slug = uniqueName("evs-versions");
    const v1 = workingAgentArchive();
    const first = await push(slug, v1, { message: "v1" });

    const again = await clients.evalCommand.push({ org: org(), slug, artifact: v1, message: "ignored" });
    expect(again).toEqual(first);

    const tagged = await clients.evalCommand.push({ org: org(), slug, artifact: v1, tag: "stable" });
    expect(tagged.spec?.tag).toBe("stable");
    expect(tagged.status?.digest).toBe(digestOf(v1));
    expect((await clients.evalQuery.listVersions({ org: org(), slug })).entries).toHaveLength(1);

    const v2 = workingAgentArchive("a note beside the case");
    const second = await clients.evalCommand.push({ org: org(), slug, artifact: v2, message: "v2" });
    expect(second.metadata?.id).toBe(first.metadata?.id);
    expect(second.status?.digest).toBe(digestOf(v2));
    expect(second.metadata?.version?.previousVersionId).toBe(digestOf(v1));

    const history = await clients.evalQuery.listVersions({ org: org(), slug });
    expect(history.entries.map((e) => [e.digest, e.tag, e.isCurrent, e.message])).toEqual([
      [digestOf(v2), "", true, "v2"],
      [digestOf(v1), "stable", false, "v1"],
    ]);
  });

  it("[rpc:EvalQueryController.getByReference] reads the eval at its head, by tag and by digest", async () => {
    const slug = uniqueName("evs-ladder");
    const v1 = oneCaseEvalArchive("What does the refund policy say?");
    const v2 = oneCaseEvalArchive("What does the returns policy say?");
    await push(slug, v1, { tag: "stable" });
    await clients.evalCommand.push({ org: org(), slug, artifact: v2 });

    expect((await clients.evalQuery.getByReference(ref(slug))).status?.digest).toBe(digestOf(v2));
    const byTag = await clients.evalQuery.getByReference(ref(slug, "stable"));
    expect(byTag.status?.digest).toBe(digestOf(v1));
    expect(byTag.spec?.tag).toBe("stable");
    expect((await clients.evalQuery.getByReference(ref(slug, digestOf(v2)))).status?.digest).toBe(digestOf(v2));
    await expectGrpcCode(
      () => clients.evalQuery.getByReference(ref(slug, "0".repeat(64))),
      Code.NotFound,
      "getByReference at a digest the eval never held",
    );
  });
});

describe("Eval conformance — downloads", () => {
  it("[rpc:EvalQueryController.download] returns the bytes that were pushed, at the head and at an older digest", async () => {
    const slug = uniqueName("evs-download");
    const v1 = workingAgentArchive();
    const v2 = workingAgentArchive("changed");
    await push(slug, v1);
    await clients.evalCommand.push({ org: org(), slug, artifact: v2 });

    const head = await clients.evalQuery.download(ref(slug));
    expect(head.digest).toBe(digestOf(v2));
    expect(Buffer.from(head.artifact).equals(Buffer.from(v2)), "the head's archive verbatim").toBe(true);
    const old = await clients.evalQuery.download(ref(slug, digestOf(v1)));
    expect(old.digest).toBe(digestOf(v1));
    expect(Buffer.from(old.artifact).equals(Buffer.from(v1)), "the older version's archive verbatim").toBe(true);
    await expectGrpcCode(
      () => clients.evalQuery.download(ref(uniqueName("evs-missing"))),
      Code.NotFound,
      "download of an eval that does not exist",
    );
  });

  it("[rpc:EvalQueryController.getDownloadUrl] serves a version's bytes over the transfer lane", async (ctx) => {
    if (!target.capabilities.skillArtifactTransferLane) return ctx.skip();
    const slug = uniqueName("evs-url");
    const v1 = workingAgentArchive();
    await push(slug, v1, { tag: "stable" });
    await clients.evalCommand.push({ org: org(), slug, artifact: workingAgentArchive("later") });

    const minted = await clients.evalQuery.getDownloadUrl(ref(slug, "stable"));
    expect(minted.digest).toBe(digestOf(v1));
    expect(minted.sizeBytes).toBe(BigInt(v1.length));
    const response = await fetch(minted.url);
    expect(response.ok, `download GET succeeds (HTTP ${response.status})`).toBe(true);
    expect(Buffer.from(await response.arrayBuffer()).equals(Buffer.from(v1)), "the tagged version verbatim").toBe(true);
  });

  it("[rpc:EvalCommandController.createArtifactUploadUrl] [rpc:EvalCommandController.push] stores a staged push exactly as an inline one", async (ctx) => {
    if (!target.capabilities.skillArtifactTransferLane) return ctx.skip();
    const slug = uniqueName("evs-staged");
    const archive = workingAgentArchive();
    const minted = await clients.evalCommand.createArtifactUploadUrl({
      org: org(),
      slug,
      sizeBytes: BigInt(archive.length),
    });
    expect(minted.url).toMatch(/^https?:\/\//);
    expect(minted.artifactUploadRef).not.toBe("");
    const put = await fetch(minted.url, {
      method: "PUT",
      body: Buffer.from(archive),
      headers: { "content-type": "application/zip" },
    });
    expect(put.ok, `staging PUT succeeds (HTTP ${put.status})`).toBe(true);

    const staged = await clients.evalCommand.push({ org: org(), slug, artifactUploadRef: minted.artifactUploadRef });
    fixtures.defer(() =>
      clients.evalCommand.delete({ value: staged.metadata!.id }).then(
        () => undefined,
        () => undefined,
      ),
    );
    expect(staged.status?.digest).toBe(digestOf(archive));
    // Content addressing must not care how the bytes travelled.
    const inline = await clients.evalCommand.push({ org: org(), slug, artifact: archive });
    expect(inline).toEqual(staged);
  });
});

describe("Eval conformance — the organization's evals", () => {
  it("[rpc:EvalQueryController.list] [rpc:EvalCommandController.updateVisibility] lists the organization's evals newest first and re-levels one", async () => {
    const own = await target.provisionTenancy();
    try {
      const first = await clients.evalCommand.push({
        org: own.org,
        slug: uniqueName("evs-listed"),
        artifact: oneCaseEvalArchive("First."),
      });
      const second = await clients.evalCommand.push({
        org: own.org,
        slug: uniqueName("evs-listed"),
        artifact: oneCaseEvalArchive("Second."),
      });
      const page = await clients.evalQuery.list({ org: own.org });
      expect(page.entries.map((e) => e.metadata?.id)).toEqual([second.metadata!.id, first.metadata!.id]);

      const leveled = await clients.evalCommand.updateVisibility({
        resourceId: first.metadata!.id,
        visibility: ApiResourceVisibility.visibility_private,
      });
      expect(leveled.metadata?.visibility).toBe(ApiResourceVisibility.visibility_private);
      await expectGrpcCode(
        () =>
          clients.evalCommand.updateVisibility({
            resourceId: first.metadata!.id,
            visibility: ApiResourceVisibility.visibility_child_orgs,
          }),
        Code.InvalidArgument,
        "an eval shared with child organizations",
      );
    } finally {
      await target.cleanupTenancy(own);
    }
  });

  it("[rpc:EvalCommandController.delete] removes the eval and its history; a read then answers NotFound", async () => {
    const slug = uniqueName("evs-deleted");
    const pushed = await clients.evalCommand.push({ org: org(), slug, artifact: oneCaseEvalArchive("Gone soon.") });
    const deleted = await clients.evalCommand.delete({ value: pushed.metadata!.id });
    expect(deleted.metadata?.id).toBe(pushed.metadata!.id);
    await expectGrpcCode(() => clients.evalQuery.get({ value: pushed.metadata!.id }), Code.NotFound, "get after delete");
    await expectGrpcCode(() => clients.evalQuery.download(ref(slug)), Code.NotFound, "download after delete");
  });
});

describe("Eval conformance — refusals before any write", () => {
  it("refuses bytes that are not an archive, a folder where no case loads, and the tag latest", async () => {
    const slug = uniqueName("evs-refused");
    await expectGrpcCode(
      () => clients.evalCommand.push({ org: org(), slug, artifact: new TextEncoder().encode("not a zip") }),
      Code.InvalidArgument,
      "not a zip",
    );
    const caseless = await expectGrpcCode(
      () => clients.evalCommand.push({ org: org(), slug, artifact: evalArchive({ "c/prompt.md": "No grader." }) }),
      Code.InvalidArgument,
      "a folder where no case loads",
    );
    expect(caseless.rawMessage).toContain("no case in the folder loads");
    await expectGrpcCode(
      () => clients.evalCommand.push({ org: org(), slug, artifact: oneCaseEvalArchive("Tagged."), tag: "latest" }),
      Code.InvalidArgument,
      "the tag latest",
    );
    await expectGrpcCode(() => clients.evalQuery.getByReference(ref(slug)), Code.NotFound, "nothing was written");
  });
});
