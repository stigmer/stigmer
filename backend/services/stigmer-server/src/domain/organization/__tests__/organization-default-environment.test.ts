/**
 * Pins an organization's default Environment
 * (`spec.preferences.default_environment_ref`) to the reference rule every
 * other reference meets (pipeline/steps/references.ts), through the REAL
 * stack: a composed trusted-local server, native gRPC clients.
 *
 *   - update stores a default named by slug alone by its id, and answers
 *     with the Environment's current slug;
 *   - a default naming an Environment that does not exist is refused, and
 *     the stored default stays as it was;
 *   - the Environment's delete guard, which compares ids, then refuses to
 *     delete a default that was written by slug;
 *   - a child organization may be created naming its parent's Environment
 *     shared with child organizations (clause iii, answered from the parent
 *     the new organization's own row names), stored by id; one only the
 *     parent's members see is refused, and no organization is created;
 *   - an edit that keeps the stored default, and the embedding another
 *     chain wrote, judges neither again.
 *
 * An organization's editors are its admins, who own every Environment of
 * it (environment.fga), so the writer clause never refuses one of them in
 * their own organization; the cross-organization clause is the one a
 * default can fail beside a missing target.
 *
 * Signed in (the built-in evaluator over the compiled model), a person with
 * no standing on a parent organization who creates a child of it naming a
 * default gets the child-organization denial, the same sentence whether or
 * not the parent shares an Environment of that name: the reference is
 * judged only after the parent is authorized, so the create answers nothing
 * about what the parent holds.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { clone, create } from "@bufbuild/protobuf";
import { Code, createClient } from "@connectrpc/connect";
import type { Client, Transport } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { EnvironmentCommandController } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/command_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/apis/ai/stigmer/commons/apiresource/enum_pb";
import { ApiResourceReferenceSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";
import { OrganizationSchema } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationCommandController } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/command_pb";
import { OrganizationQueryController } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/query_pb";
import { OrganizationPreferencesSchema, OrganizationSpecSchema } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/spec_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import {
  baseConfig,
  fakeJwt,
  fakeVerifier,
  silentLogger,
  transportFor,
} from "../../../extensions/__tests__/composed-support.js";
import { errorOf } from "../../../pipeline/__tests__/support.js";
import { FAKE_SANDBOX_DRIVER, environmentInput, sandboxUnit } from "../../environment/__tests__/support.js";
import { IdentityAccountCommandController } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/command_pb";
import { CHILD_ORGS_DENIED_MESSAGE } from "../children.js";
import { stillNamedMessage } from "../../environment/steps.js";
import { organizationId, organizationInput, seedOrganizations } from "./support.js";

describe("an organization's default Environment is judged as every reference is (trusted-local, composed server)", () => {
  const ORG = "default-env-acme";
  let dir: string;
  let server: ComposedServer;
  let orgId: string;
  let organizations: Client<typeof OrganizationCommandController>;
  let organizationQuery: Client<typeof OrganizationQueryController>;
  let environments: Client<typeof EnvironmentCommandController>;

  /** The organization as stored, with its default replaced by `ref` (no default when undefined). */
  async function withDefault(
    id: string,
    ref: { org?: string; slug?: string; id?: string } | undefined,
  ) {
    const resource = clone(OrganizationSchema, await organizationQuery.get({ value: id }));
    resource.spec ??= create(OrganizationSpecSchema);
    resource.spec.preferences ??= create(OrganizationPreferencesSchema);
    resource.spec.preferences.defaultEnvironmentRef =
      ref === undefined ? undefined : create(ApiResourceReferenceSchema, { kind: ApiResourceKind.environment, ...ref });
    return resource;
  }

  /** The default as the store holds it. */
  async function storedDefault(id: string) {
    const stored = await server.store.getResource(ApiResourceKind.organization, id, OrganizationSchema);
    return stored.spec?.preferences?.defaultEnvironmentRef;
  }

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "organization-default-environment-"));
    server = await composeServer({
      config: loadConfig(baseConfig(dir)),
      logger: silentLogger,
      portOverride: 0,
      host: "127.0.0.1",
    });
    const port = await server.start();
    const transport: Transport = transportFor(port);
    orgId = organizationId(await seedOrganizations(transport, [ORG]), ORG);
    organizations = createClient(OrganizationCommandController, transport);
    organizationQuery = createClient(OrganizationQueryController, transport);
    environments = createClient(EnvironmentCommandController, transport);
  });

  afterAll(async () => {
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  it("stores a default named by slug alone by its id, and answers with its current slug", async () => {
    const box = await environments.create(environmentInput(ORG, "Base Tools"));
    const updated = await organizations.update({
      resource: await withDefault(orgId, { slug: "base-tools" }),
      updateMask: { paths: ["spec.preferences.default_environment_ref"] },
    });
    expect(updated.spec?.preferences?.defaultEnvironmentRef?.slug).toBe("base-tools");
    const stored = await storedDefault(orgId);
    expect(stored?.id).toBe(box.metadata!.id);
    expect(stored?.org).toBe(orgId);
    expect(stored?.slug ?? "").toBe("");
  });

  it("refuses a default naming an Environment that does not exist, keeping the stored one", async () => {
    const before = await storedDefault(orgId);
    const resource = await withDefault(orgId, { slug: "no-such-box" });
    const refused = await errorOf(() =>
      organizations.update({ resource, updateMask: { paths: ["spec.preferences.default_environment_ref"] } }),
    );
    expect(refused.code).toBe(Code.FailedPrecondition);
    expect(refused.rawMessage).toContain("referenced environment(s) not found: 'no-such-box'");
    expect((await storedDefault(orgId))?.id).toBe(before?.id);
  });

  it("then refuses to delete the Environment the slug-written default names", async () => {
    const stored = await storedDefault(orgId);
    const refused = await errorOf(() => environments.delete({ value: stored!.id }));
    expect(refused.code).toBe(Code.FailedPrecondition);
    expect(refused.rawMessage).toBe(stillNamedMessage("base-tools", ["the organization's default"]));
  });

  it("an edit that keeps the stored default judges it no further, and clearing it frees the Environment", async () => {
    const kept = clone(OrganizationSchema, await organizationQuery.get({ value: orgId }));
    kept.spec!.description = "still defaulted";
    const updated = await organizations.update({ resource: kept, updateMask: { paths: ["spec.description"] } });
    expect(updated.spec?.description).toBe("still defaulted");
    const id = (await storedDefault(orgId))!.id;

    await organizations.update({
      resource: await withDefault(orgId, undefined),
      updateMask: { paths: ["spec.preferences.default_environment_ref"] },
    });
    expect(await storedDefault(orgId)).toBeUndefined();
    const deleted = await environments.delete({ value: id });
    expect(deleted.metadata?.id).toBe(id);
  });

  it("creates a child organization naming its parent's Environment shared with child organizations, by id", async () => {
    const shared = await environments.create(
      environmentInput(ORG, "Shared Tools", {}, ApiResourceVisibility.visibility_child_orgs),
    );
    const child = await organizations.create({
      ...organizationInput("default-env-kids"),
      spec: {
        description: "kids",
        parentOrg: orgId,
        preferences: { defaultEnvironmentRef: { kind: ApiResourceKind.environment, org: ORG, slug: "shared-tools" } },
      },
    });
    const stored = await storedDefault(child.metadata!.id);
    expect(stored?.id).toBe(shared.metadata!.id);
    expect(stored?.org).toBe(orgId);
  });

  it("refuses a child organization naming a parent's Environment its members alone see, and creates nothing", async () => {
    await environments.create(environmentInput(ORG, "Members Only"));
    const refused = await errorOf(() =>
      organizations.create({
        ...organizationInput("default-env-strays"),
        spec: {
          description: "strays",
          parentOrg: orgId,
          preferences: { defaultEnvironmentRef: { kind: ApiResourceKind.environment, org: ORG, slug: "members-only" } },
        },
      }),
    );
    expect(refused.code).toBe(Code.FailedPrecondition);
    expect(refused.rawMessage).toContain("referenced environment 'members-only' of another organization is not available");
    const children = await organizationQuery.listChildOrgs({ org: orgId });
    expect(children.entries.map((entry) => entry.metadata?.slug)).toEqual(["default-env-kids"]);
  });
});

describe("a child organization's default, created by someone with no standing on its parent (signed in, composed server)", () => {
  const CAROL = "fake|default-env-carol";
  const DAVE = "fake|default-env-dave";
  const PARENT = "default-env-parent";
  let dir: string;
  let server: ComposedServer;
  let port: number;
  let parentId: string;

  const asCarol = (): Transport => transportFor(port, fakeJwt(CAROL, "carol@example.com"));
  const asDave = (): Transport => transportFor(port, fakeJwt(DAVE, "dave@example.com"));

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "organization-default-environment-signed-in-"));
    vi.stubEnv("STIGMER_ACTIVITY_ROUTING", "session");
    server = await composeServer({
      config: loadConfig({ ...baseConfig(dir), SANDBOX_PROVISIONER_TYPE: FAKE_SANDBOX_DRIVER }),
      logger: silentLogger,
      extensions: [sandboxUnit(undefined, { requireAuthentication: true, identityVerifiers: [fakeVerifier] })],
      portOverride: 0,
      host: "127.0.0.1",
    });
    port = await server.start();
    await createClient(IdentityAccountCommandController, asCarol()).provisionMyAccount({});
    const parent = await createClient(OrganizationCommandController, asCarol()).create(organizationInput(PARENT));
    parentId = parent.metadata!.id;
    await createClient(EnvironmentCommandController, asCarol()).create(
      environmentInput(PARENT, "Shared Box", {}, ApiResourceVisibility.visibility_child_orgs),
    );
    // Dave provisions after the parent exists: he joins it as a member,
    // who may not manage its child organizations.
    await createClient(IdentityAccountCommandController, asDave()).provisionMyAccount({});
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  async function daveCreatesChildNaming(slug: string, childSlug: string) {
    return errorOf(() =>
      createClient(OrganizationCommandController, asDave()).create({
        ...organizationInput(childSlug),
        spec: {
          description: childSlug,
          parentOrg: parentId,
          preferences: { defaultEnvironmentRef: { kind: ApiResourceKind.environment, org: PARENT, slug } },
        },
      }),
    );
  }

  it("answers the same denial whether or not the parent shares an Environment of that name", async () => {
    const shared = await daveCreatesChildNaming("shared-box", "dave-kids-a");
    const absent = await daveCreatesChildNaming("no-such-box", "dave-kids-b");
    expect(shared.code).toBe(Code.PermissionDenied);
    expect(absent.code).toBe(Code.PermissionDenied);
    expect(shared.rawMessage).toBe(CHILD_ORGS_DENIED_MESSAGE);
    expect(absent.rawMessage).toBe(CHILD_ORGS_DENIED_MESSAGE);
  });
});
