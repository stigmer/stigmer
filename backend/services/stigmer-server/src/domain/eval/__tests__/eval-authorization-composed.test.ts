/**
 * Pins who may push, mint for and download an eval, on a real boot under
 * the BUILT-IN posture (require-authentication, the built-in evaluator over
 * the compiled model), with two people of one organization: Carol, who
 * founded it (an admin), and Dave, a member.
 *
 *   - a push or a mint naming a slug an eval was renamed away from is
 *     refused to a member who may not edit that eval as any refused push
 *     is, and only its editors hear that the slug was renamed;
 *   - while the organization lets members create agents, Dave creates his
 *     own eval and pushes its versions; a push onto Carol's eval is refused,
 *     whatever its level, and so is an upload URL naming its slug, with the
 *     one copy either question refuses with;
 *   - once Carol closes agent creation, Dave can create no eval, and still
 *     pushes versions of the one he owns, as an agent's owner still edits it;
 *   - Dave reads and downloads Carol's organization-wide eval; once she
 *     makes it private, he can download no version of it, neither the head
 *     nor an older digest he once read, inline or by URL, and its versions
 *     are refused to him too.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Transport } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { EvalCommandController } from "@stigmer/apis/ai/stigmer/agentic/eval/v1/command_pb";
import { EvalQueryController } from "@stigmer/apis/ai/stigmer/agentic/eval/v1/query_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/apis/ai/stigmer/commons/apiresource/enum_pb";
import { IdentityAccountCommandController } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/command_pb";
import { OrganizationCommandController } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/command_pb";

import { writeArchive } from "../../../archive/write.js";
import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import type { ServerExtension } from "../../../extensions/registry.js";
import {
  baseConfig,
  fakeJwt,
  fakeVerifier,
  silentLogger,
  transportFor,
} from "../../../extensions/__tests__/composed-support.js";
import { EVAL_PUSH_DENIED } from "../constants.js";

const CAROL = "fake|carol";
const DAVE = "fake|dave";
const ORG = "eval-authorization-org";

const encoder = new TextEncoder();
const JUDGE = "---\ntype: llm\n---\n\nPASS if the reply answers.\n";

function folder(prompt: string): Uint8Array {
  return writeArchive([
    { path: "c/prompt.md", bytes: encoder.encode(prompt) },
    { path: "c/graders/judge.md", bytes: encoder.encode(JUDGE) },
  ]);
}

function digestOf(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function failureOf(promise: Promise<unknown>): Promise<ConnectError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ConnectError);
    return error as ConnectError;
  }
  throw new Error("expected the call to fail");
}

describe("who may push, mint for and download an eval (built-in posture, composed server)", () => {
  let dir: string;
  let server: ComposedServer;
  let port: number;
  let orgId: string;

  const asCarol = (): Transport => transportFor(port, fakeJwt(CAROL, "carol@example.com"));
  const asDave = (): Transport => transportFor(port, fakeJwt(DAVE, "dave@example.com"));

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "eval-authorization-"));
    const unit: ServerExtension = {
      name: "fake-oidc-only",
      requireAuthentication: true,
      identityVerifiers: [fakeVerifier],
    };
    server = await composeServer({
      config: loadConfig(baseConfig(dir)),
      logger: silentLogger,
      extensions: [unit],
      portOverride: 0,
      host: "127.0.0.1",
    });
    port = await server.start();
    await createClient(IdentityAccountCommandController, asCarol()).provisionMyAccount({});
    const org = await createClient(OrganizationCommandController, asCarol()).create({
      apiVersion: "tenancy.stigmer.ai/v1",
      kind: "Organization",
      metadata: { name: ORG, slug: ORG, org: "" },
      spec: { description: ORG },
    });
    orgId = org.metadata!.id;
    await createClient(IdentityAccountCommandController, asDave()).provisionMyAccount({});
  });

  afterAll(async () => {
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  it("lets a member create and version his own eval, and refuses his push or mint onto another's", async () => {
    const carol = createClient(EvalCommandController, asCarol());
    const dave = createClient(EvalCommandController, asDave());
    await carol.push({ org: ORG, slug: "carols-cases", artifact: folder("Carol's.") });

    const daves = await dave.push({ org: ORG, slug: "daves-cases", artifact: folder("Dave's.") });
    expect(daves.metadata?.org).toBe(orgId);
    const next = await dave.push({ org: ORG, slug: "daves-cases", artifact: folder("Dave's, again.") });
    expect(next.metadata?.id).toBe(daves.metadata?.id);

    const pushOnto = await failureOf(dave.push({ org: ORG, slug: "carols-cases", artifact: folder("Taken over.") }));
    expect(pushOnto.code).toBe(Code.PermissionDenied);
    expect(pushOnto.rawMessage).toBe(EVAL_PUSH_DENIED);
    const mintOnto = await failureOf(dave.createArtifactUploadUrl({ org: ORG, slug: "carols-cases", sizeBytes: 10n }));
    expect(mintOnto.code).toBe(Code.PermissionDenied);
    expect(mintOnto.rawMessage).toBe(EVAL_PUSH_DENIED);
    const minted = await dave.createArtifactUploadUrl({ org: ORG, slug: "daves-other-cases", sizeBytes: 10n });
    expect(minted.artifactUploadRef).toMatch(/^sau_/);
  });

  it("tells only an eval's editors that a slug was renamed away from it", async () => {
    const carol = createClient(EvalCommandController, asCarol());
    const dave = createClient(EvalCommandController, asDave());
    const pushed = await carol.push({
      org: ORG,
      slug: "carols-renamed",
      artifact: folder("Renamed."),
      visibility: ApiResourceVisibility.visibility_private,
    });
    await carol.rename({ resourceId: pushed.metadata!.id, slug: "carols-renamed-now" });

    const stranger = await failureOf(dave.push({ org: ORG, slug: "carols-renamed", artifact: folder("Mine?") }));
    expect(stranger.code).toBe(Code.PermissionDenied);
    expect(stranger.rawMessage).toBe(EVAL_PUSH_DENIED);
    const strangerMint = await failureOf(dave.createArtifactUploadUrl({ org: ORG, slug: "carols-renamed", sizeBytes: 10n }));
    expect(strangerMint.code).toBe(Code.PermissionDenied);

    const owner = await failureOf(carol.push({ org: ORG, slug: "carols-renamed", artifact: folder("Again.") }));
    expect(owner.code).toBe(Code.FailedPrecondition);
  });

  it("refuses a member's new eval once agent creation is closed, and keeps his own eval his to version", async () => {
    const dave = createClient(EvalCommandController, asDave());
    const owned = await dave.push({ org: ORG, slug: "daves-kept", artifact: folder("Kept.") });
    await createClient(OrganizationCommandController, asCarol()).updatePolicies({
      orgId,
      policies: { membersCanCreateAgents: false },
    });
    try {
      const refused = await failureOf(dave.push({ org: ORG, slug: "daves-new", artifact: folder("New.") }));
      expect(refused.code).toBe(Code.PermissionDenied);
      expect(refused.rawMessage).toBe(EVAL_PUSH_DENIED);
      const mint = await failureOf(dave.createArtifactUploadUrl({ org: ORG, slug: "daves-new", sizeBytes: 10n }));
      expect(mint.code).toBe(Code.PermissionDenied);
      const versioned = await dave.push({ org: ORG, slug: "daves-kept", artifact: folder("Kept, changed.") });
      expect(versioned.metadata?.id).toBe(owned.metadata?.id);
      const carols = await createClient(EvalCommandController, asCarol()).push({
        org: ORG,
        slug: "carols-new",
        artifact: folder("Admins still create."),
      });
      expect(carols.metadata?.slug).toBe("carols-new");
    } finally {
      await createClient(OrganizationCommandController, asCarol()).updatePolicies({
        orgId,
        policies: { membersCanCreateAgents: true },
      });
    }
  });

  it("refuses every version of an eval to a member once it is private, whatever digest he holds", async () => {
    const carol = createClient(EvalCommandController, asCarol());
    const daveQuery = createClient(EvalQueryController, asDave());
    const v1 = folder("First.");
    const shared = await carol.push({ org: ORG, slug: "carols-shared", artifact: v1 });
    await carol.push({ org: ORG, slug: "carols-shared", artifact: folder("Second.") });

    const ref = { org: ORG, slug: "carols-shared", kind: ApiResourceKind.eval };
    const before = await daveQuery.download({ ...ref, version: digestOf(v1) });
    expect(new Uint8Array(before.artifact)).toEqual(v1);
    expect((await daveQuery.list({ org: ORG })).entries.map((e) => e.metadata?.slug)).toContain("carols-shared");

    await carol.updateVisibility({
      resourceId: shared.metadata!.id,
      visibility: ApiResourceVisibility.visibility_private,
    });
    for (const call of [
      () => daveQuery.download(ref),
      () => daveQuery.download({ ...ref, version: digestOf(v1) }),
      () => daveQuery.getDownloadUrl({ ...ref, version: digestOf(v1) }),
      () => daveQuery.getByReference({ ...ref, version: digestOf(v1) }),
      () => daveQuery.listVersions({ org: ORG, slug: "carols-shared" }),
      () => daveQuery.get({ value: shared.metadata!.id }),
    ]) {
      expect((await failureOf(call())).code).toBe(Code.PermissionDenied);
    }
    expect((await daveQuery.list({ org: ORG })).entries.map((e) => e.metadata?.slug)).not.toContain("carols-shared");
    const carolsCopy = await createClient(EvalQueryController, asCarol()).download({ ...ref, version: digestOf(v1) });
    expect(new Uint8Array(carolsCopy.artifact)).toEqual(v1);
  });
});
