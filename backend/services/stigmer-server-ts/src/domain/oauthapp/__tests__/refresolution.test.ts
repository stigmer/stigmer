/**
 * Pins the OAuthApp ref-resolution ladder against Go's
 * refresolution_test.go table: exact (org, slug) wins; a UNIQUE slug-only
 * match is honored across orgs (the seedpack `org: stigmer` case, #584);
 * ambiguity resolves to nothing; an empty slug is the DCR/manual-token
 * arm, not a lookup.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { OAuthAppSchema } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/api_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import type { Store } from "../../../store/interface.js";
import { resolveOAuthAppRef } from "../refresolution.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });

let dir: string;
let store: Store;

async function seedApp(id: string, org: string, slug: string): Promise<void> {
  await store.saveResource(
    ApiResourceKind.oauth_app,
    id,
    OAuthAppSchema,
    create(OAuthAppSchema, { metadata: { id, org, slug, name: slug } }),
  );
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "refresolution-test-"));
  store = SqliteStore.open(path.join(dir, "stigmer.db"), silentLogger);
  await seedApp("oaa_github_acme", "acme", "github");
  await seedApp("oaa_github_beta", "beta-corp", "github");
  await seedApp("oaa_slack_stigmer", "stigmer", "slack");
});

afterAll(async () => {
  await store.close();
  rmSync(dir, { recursive: true, force: true });
});

function ref(org: string, slug: string) {
  return create(ApiResourceReferenceSchema, { org, slug });
}

describe("resolveOAuthAppRef", () => {
  it("resolves an exact (org, slug) match even when the slug exists elsewhere", async () => {
    const app = await resolveOAuthAppRef(store, ref("beta-corp", "github"), silentLogger);
    expect(app?.metadata?.id).toBe("oaa_github_beta");
  });

  it("honors a UNIQUE slug-only match when the ref's org has no app (the seedpack case, #584)", async () => {
    // Two orgs hold 'github' and neither is 'stigmer': ambiguous → nothing.
    expect(await resolveOAuthAppRef(store, ref("stigmer", "github"), silentLogger)).toBeUndefined();

    const unique = await resolveOAuthAppRef(store, ref("some-user-org", "slack"), silentLogger);
    expect(unique?.metadata?.id).toBe("oaa_slack_stigmer");
  });

  it("refuses to pick among ambiguous slug-only matches", async () => {
    expect(await resolveOAuthAppRef(store, ref("", "github"), silentLogger)).toBeUndefined();
  });

  it("an org-less ref resolves through a UNIQUE slug match (Go's org-less arm)", async () => {
    const app = await resolveOAuthAppRef(store, ref("", "slack"), silentLogger);
    expect(app?.metadata?.id).toBe("oaa_slack_stigmer");
  });

  it("resolves nothing for an unknown slug", async () => {
    expect(await resolveOAuthAppRef(store, ref("acme", "never-applied"), silentLogger)).toBeUndefined();
  });

  it("treats an absent or empty-slug ref as the DCR/manual-token arm", async () => {
    expect(await resolveOAuthAppRef(store, undefined, silentLogger)).toBeUndefined();
    expect(await resolveOAuthAppRef(store, ref("acme", ""), silentLogger)).toBeUndefined();
  });
});
