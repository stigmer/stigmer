/**
 * Pins the Environment controller (../controller.ts) and its steps
 * (../steps.ts) through the REAL stack: composed servers on ephemeral
 * ports, native gRPC clients, the full interceptor chain, with a sandbox
 * lane whose fake driver states what it can do (./support.ts).
 *
 * On a trusted-local server whose driver states no environmentSupport:
 *   - create mints an `env_` id and stores an Environment with no
 *     networking type as unrestricted;
 *   - saving limited networking is FAILED_PRECONDITION with the "cannot
 *     enforce" sentence, and saving packages FAILED_PRECONDITION, on create
 *     and on update alike, leaving the stored row as it was;
 *   - a refused host is INVALID_ARGUMENT naming the host as stored
 *     (normalized), judged before the support is asked;
 *   - delete is refused while an agent of the Environment's organization
 *     names it as environment_ref, while a routine's
 *     spec.agent.environment_ref names it, and while it is the
 *     organization's preferences.default_environment_ref, each refusal
 *     naming that referrer; a child organization's agent, routine and
 *     default hold it too, each named with the child; another
 *     organization's agent naming the same id does not hold it; once unreferenced the delete succeeds and the
 *     Environment is gone;
 *   - apply creates by slug, then updates the same Environment; rename
 *     changes the slug getByReference finds it by; updateVisibility narrows
 *     it to private, and an id naming nothing is NOT_FOUND.
 *
 * On a server under the require-authentication posture (the built-in
 * evaluator over the compiled model) whose driver supports both limited
 * networking and packages, with Carol, who founded the organization (an
 * admin), and Dave, a member:
 *   - Carol saves limited networking with packages; the hosts are stored
 *     lower case, without a trailing dot, each once;
 *   - update re-runs the host refusal and re-normalizes;
 *   - Dave may not create an Environment (PERMISSION_DENIED), and creates
 *     nothing; Carol may.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { Code, createClient } from "@connectrpc/connect";
import type { Client, Transport } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import type { Environment } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/api_pb";
import { EnvironmentCommandController } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/command_pb";
import { EnvironmentQueryController } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/query_pb";
import { EnvironmentSpecSchema, NetworkingType } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/spec_pb";
import { RoutineSchema } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/apis/ai/stigmer/commons/apiresource/enum_pb";
import { ApiResourceReferenceSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";
import { IdentityAccountCommandController } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/command_pb";
import { OrganizationSchema } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationCommandController } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/command_pb";
import { OrganizationPreferencesSchema } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/spec_pb";

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
import { organizationId, organizationInput, seedOrganizations } from "../../organization/__tests__/support.js";
import { stillNamedMessage } from "../steps.js";
import { FAKE_SANDBOX_DRIVER, environmentInput, sandboxUnit } from "./support.js";

/** The stored Environment with its spec replaced, as an update request carries it. */
function withSpec(environment: Environment, spec: MessageInitShape<typeof EnvironmentSpecSchema>): Environment {
  return { ...environment, spec: create(EnvironmentSpecSchema, spec) };
}

describe("the Environment controller on a lane whose driver states no support (trusted-local, composed server)", () => {
  const ORG = "env-acme";
  const OTHER_ORG = "env-globex";
  const CHILD_ORG = "env-acme-kids";
  let dir: string;
  let server: ComposedServer;
  let orgId: string;
  let otherOrgId: string;
  let childOrgId: string;
  let command: Client<typeof EnvironmentCommandController>;
  let query: Client<typeof EnvironmentQueryController>;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "environment-domain-test-"));
    vi.stubEnv("STIGMER_ACTIVITY_ROUTING", "session");
    server = await composeServer({
      config: loadConfig({ ...baseConfig(dir), SANDBOX_PROVISIONER_TYPE: FAKE_SANDBOX_DRIVER }),
      logger: silentLogger,
      extensions: [sandboxUnit(undefined)],
      portOverride: 0,
      host: "127.0.0.1",
    });
    const port = await server.start();
    const transport: Transport = transportFor(port);
    const organizations = await seedOrganizations(transport, [ORG, OTHER_ORG]);
    orgId = organizationId(organizations, ORG);
    otherOrgId = organizationId(organizations, OTHER_ORG);
    const child = await createClient(OrganizationCommandController, transport).create({
      ...organizationInput(CHILD_ORG),
      spec: { description: CHILD_ORG, parentOrg: orgId },
    });
    childOrgId = child.metadata!.id;
    command = createClient(EnvironmentCommandController, transport);
    query = createClient(EnvironmentQueryController, transport);
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  it("mints an env_ id and stores an Environment with no networking type as unrestricted", async () => {
    const created = await command.create(environmentInput(ORG, "Plain Box", { description: "nothing special" }));
    expect(created.metadata?.id).toMatch(/^env_/);
    expect(created.metadata?.slug).toBe("plain-box");
    expect(created.metadata?.org).toBe(orgId);
    expect(created.spec?.networking?.type).toBe(NetworkingType.unrestricted);
    const read = await query.get({ value: created.metadata!.id });
    expect(read.spec?.networking?.type).toBe(NetworkingType.unrestricted);
  });

  it("refuses to save limited networking the driver cannot enforce, and creates nothing", async () => {
    const refused = await errorOf(() =>
      command.create(
        environmentInput(ORG, "Fenced", {
          networking: { type: NetworkingType.limited, allowedHosts: ["api.github.com"] },
        }),
      ),
    );
    expect(refused.code).toBe(Code.FailedPrecondition);
    expect(refused.rawMessage).toContain("environment 'fenced' limits networking to listed hosts");
    expect(refused.rawMessage).toContain("which this server's sandboxes cannot enforce");
    const listed = await query.list({ org: ORG });
    expect(listed.entries.map((entry) => entry.metadata?.slug)).not.toContain("fenced");
  });

  it("refuses to save packages the driver cannot install", async () => {
    const refused = await errorOf(() =>
      command.create(
        environmentInput(ORG, "Tooled", {
          networking: { type: NetworkingType.unrestricted },
          packages: { pip: ["requests"] },
        }),
      ),
    );
    expect(refused.code).toBe(Code.FailedPrecondition);
    expect(refused.rawMessage).toContain("environment 'tooled' installs packages, which this server's sandboxes cannot do");
  });

  it("refuses a host the server does not admit with INVALID_ARGUMENT naming it as stored, before asking the support", async () => {
    const refused = await errorOf(() =>
      command.create(
        environmentInput(ORG, "Inside", {
          networking: { type: NetworkingType.limited, allowedHosts: ["api.github.com", "Kube-DNS.kube-system.SVC."] },
        }),
      ),
    );
    expect(refused.code).toBe(Code.InvalidArgument);
    expect(refused.rawMessage).toContain("'kube-dns.kube-system.svc'");
    expect(refused.rawMessage).toContain("private name (.svc)");
  });

  it("re-runs the same refusals on update, leaving the stored row as it was", async () => {
    const created = await command.create(environmentInput(ORG, "Editable"));
    const id = created.metadata!.id;

    const toLimited = await errorOf(() =>
      command.update({
        resource: withSpec(created, {
          networking: { type: NetworkingType.limited, allowedHosts: ["api.github.com"] },
        }),
        updateMask: { paths: ["spec"] },
      }),
    );
    expect(toLimited.code).toBe(Code.FailedPrecondition);
    expect(toLimited.rawMessage).toContain("environment 'editable' limits networking to listed hosts");
    expect(toLimited.rawMessage).toContain("cannot enforce");

    const toPackages = await errorOf(() =>
      command.update({
        resource: withSpec(created, { packages: { npm: ["typescript"] } }),
        updateMask: { paths: ["spec"] },
      }),
    );
    expect(toPackages.code).toBe(Code.FailedPrecondition);
    expect(toPackages.rawMessage).toContain("environment 'editable' installs packages");

    const toMetadata = await errorOf(() =>
      command.update({
        resource: withSpec(created, {
          networking: { type: NetworkingType.limited, allowedHosts: ["metadata.google.internal"] },
        }),
        updateMask: { paths: ["spec"] },
      }),
    );
    expect(toMetadata.code).toBe(Code.InvalidArgument);
    expect(toMetadata.rawMessage).toContain("'metadata.google.internal'");

    const stored = await query.get({ value: id });
    expect(stored.spec?.networking?.type).toBe(NetworkingType.unrestricted);
    expect(stored.spec?.packages?.npm ?? []).toEqual([]);

    const described = await command.update({
      resource: withSpec(created, { description: "still unrestricted" }),
      updateMask: { paths: ["spec"] },
    });
    expect(described.spec?.description).toBe("still unrestricted");
  });

  it("applies by slug: the first apply creates, the second updates the same Environment", async () => {
    const first = await command.apply(environmentInput(ORG, "Applied", { description: "v1" }));
    const second = await command.apply(environmentInput(ORG, "Applied", { description: "v2" }));
    expect(second.metadata?.id).toBe(first.metadata?.id);
    expect(second.spec?.description).toBe("v2");
    expect(second.spec?.networking?.type).toBe(NetworkingType.unrestricted);
  });

  it("renames it, and getByReference finds it by its new slug", async () => {
    const created = await command.create(environmentInput(ORG, "Before Rename"));
    const renamed = await command.rename({ resourceId: created.metadata!.id, slug: "after-rename" });
    expect(renamed.metadata?.slug).toBe("after-rename");
    const found = await query.getByReference({ org: ORG, slug: "after-rename" });
    expect(found.metadata?.id).toBe(created.metadata?.id);
  });

  it("narrows its visibility to private, and answers NOT_FOUND for an id that names nothing", async () => {
    const created = await command.create(environmentInput(ORG, "Shared Box"));
    expect(created.metadata?.visibility).toBe(ApiResourceVisibility.visibility_org);
    const narrowed = await command.updateVisibility({
      resourceId: created.metadata!.id,
      visibility: ApiResourceVisibility.visibility_private,
    });
    expect(narrowed.metadata?.visibility).toBe(ApiResourceVisibility.visibility_private);
    expect((await query.get({ value: created.metadata!.id })).metadata?.visibility).toBe(ApiResourceVisibility.visibility_private);
    const missing = await errorOf(() =>
      command.updateVisibility({ resourceId: "env_01nothingnothingnothing00", visibility: ApiResourceVisibility.visibility_private }),
    );
    expect(missing.code).toBe(Code.NotFound);
  });

  describe("delete", () => {
    async function saveAgent(id: string, org: string, slug: string, environmentId: string): Promise<void> {
      await server.store.saveResource(
        ApiResourceKind.agent,
        id,
        AgentSchema,
        create(AgentSchema, {
          metadata: { id, org, slug, name: slug },
          spec: { environmentRef: { kind: ApiResourceKind.environment, org, id: environmentId } },
        }),
      );
    }

    async function saveRoutine(id: string, slug: string, environmentId: string, org = orgId): Promise<void> {
      await server.store.saveResource(
        ApiResourceKind.routine,
        id,
        RoutineSchema,
        create(RoutineSchema, {
          metadata: { id, org, slug, name: slug },
          spec: {
            cron: "0 9 * * *",
            agent: {
              agentRef: { id: "agt_01nobody" },
              message: "rounds",
              environmentRef: { kind: ApiResourceKind.environment, org: orgId, id: environmentId },
            },
          },
        }),
      );
    }

    async function setOrganizationDefault(environmentId: string, org = orgId): Promise<void> {
      const organization = await server.store.getResource(ApiResourceKind.organization, org, OrganizationSchema);
      const preferences = (organization.spec!.preferences ??= create(OrganizationPreferencesSchema));
      preferences.defaultEnvironmentRef =
        environmentId === ""
          ? undefined
          : create(ApiResourceReferenceSchema, { kind: ApiResourceKind.environment, org: orgId, id: environmentId });
      await server.store.saveResource(ApiResourceKind.organization, org, OrganizationSchema, organization);
    }

    let guarded: Environment;

    beforeAll(async () => {
      guarded = await command.create(environmentInput(ORG, "Guarded"));
    });

    it("is refused while an agent of the organization names the Environment, naming the agent", async () => {
      const id = guarded.metadata!.id;
      await saveAgent("agt_01reviewer", orgId, "reviewer", id);
      // Another organization's agent naming the same id does not hold it.
      await saveAgent("agt_01theirs", otherOrgId, "theirs", id);
      const refused = await errorOf(() => command.delete({ value: id }));
      expect(refused.code).toBe(Code.FailedPrecondition);
      expect(refused.rawMessage).toBe(stillNamedMessage("guarded", ["agent 'reviewer'"]));
      await server.store.deleteResource(ApiResourceKind.agent, "agt_01reviewer");
    });

    it("is refused while a routine names it as its invocation's environment, naming the routine", async () => {
      const id = guarded.metadata!.id;
      await saveRoutine("rtn_01daily", "daily", id);
      const refused = await errorOf(() => command.delete({ value: id }));
      expect(refused.code).toBe(Code.FailedPrecondition);
      expect(refused.rawMessage).toBe(stillNamedMessage("guarded", ["routine 'daily'"]));
      await server.store.deleteResource(ApiResourceKind.routine, "rtn_01daily");
    });

    it("is refused while it is the organization's default, saying so", async () => {
      const id = guarded.metadata!.id;
      await setOrganizationDefault(id);
      const refused = await errorOf(() => command.delete({ value: id }));
      expect(refused.code).toBe(Code.FailedPrecondition);
      expect(refused.rawMessage).toBe(stillNamedMessage("guarded", ["the organization's default"]));
      expect(refused.rawMessage).toContain("remove it from them first");
      await setOrganizationDefault("");
    });

    it("is refused while a child organization names the Environment it shares, naming each referrer and its organization", async () => {
      const id = guarded.metadata!.id;
      await saveAgent("agt_01kidagent", childOrgId, "kid-agent", id);
      await saveRoutine("rtn_01kidrounds", "kid-rounds", id, childOrgId);
      await setOrganizationDefault(id, childOrgId);
      const refused = await errorOf(() => command.delete({ value: id }));
      expect(refused.code).toBe(Code.FailedPrecondition);
      expect(refused.rawMessage).toBe(
        stillNamedMessage("guarded", [
          `agent 'kid-agent' of organization '${CHILD_ORG}'`,
          `routine 'kid-rounds' of organization '${CHILD_ORG}'`,
          `the default of organization '${CHILD_ORG}'`,
        ]),
      );
      await server.store.deleteResource(ApiResourceKind.agent, "agt_01kidagent");
      await server.store.deleteResource(ApiResourceKind.routine, "rtn_01kidrounds");
      await setOrganizationDefault("", childOrgId);
    });

    it("names every referrer at once, agents then routines then the default", async () => {
      const id = guarded.metadata!.id;
      await saveAgent("agt_01writer", orgId, "writer", id);
      await saveAgent("agt_01auditor", orgId, "auditor", id);
      await saveRoutine("rtn_01weekly", "weekly", id);
      await setOrganizationDefault(id);
      const refused = await errorOf(() => command.delete({ value: id }));
      expect(refused.rawMessage).toBe(
        stillNamedMessage("guarded", [
          "agent 'auditor'",
          "agent 'writer'",
          "routine 'weekly'",
          "the organization's default",
        ]),
      );
      await server.store.deleteResource(ApiResourceKind.agent, "agt_01writer");
      await server.store.deleteResource(ApiResourceKind.agent, "agt_01auditor");
      await server.store.deleteResource(ApiResourceKind.routine, "rtn_01weekly");
      await setOrganizationDefault("");
    });

    it("succeeds once nothing of the organization names it, and the Environment is gone", async () => {
      const id = guarded.metadata!.id;
      const deleted = await command.delete({ value: id });
      expect(deleted.metadata?.id).toBe(id);
      const gone = await errorOf(() => query.get({ value: id }));
      expect(gone.code).toBe(Code.NotFound);
      // Its name is free again.
      const again = await command.create(environmentInput(ORG, "Guarded"));
      expect(again.metadata?.slug).toBe("guarded");
      expect(again.metadata?.id).not.toBe(id);
    });
  });
});

describe("the Environment controller under an authentication posture, on a lane that supports both (composed server)", () => {
  const CAROL = "fake|env-carol";
  const DAVE = "fake|env-dave";
  const ORG = "env-auth-org";
  let dir: string;
  let server: ComposedServer;
  let port: number;

  const asCarol = (): Transport => transportFor(port, fakeJwt(CAROL, "carol@example.com"));
  const asDave = (): Transport => transportFor(port, fakeJwt(DAVE, "dave@example.com"));

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "environment-authorization-"));
    vi.stubEnv("STIGMER_ACTIVITY_ROUTING", "session");
    server = await composeServer({
      config: loadConfig({ ...baseConfig(dir), SANDBOX_PROVISIONER_TYPE: FAKE_SANDBOX_DRIVER }),
      logger: silentLogger,
      extensions: [
        sandboxUnit(
          { limitedNetworking: true, packages: true },
          { requireAuthentication: true, identityVerifiers: [fakeVerifier] },
        ),
      ],
      portOverride: 0,
      host: "127.0.0.1",
    });
    port = await server.start();
    await createClient(IdentityAccountCommandController, asCarol()).provisionMyAccount({});
    await createClient(OrganizationCommandController, asCarol()).create({
      apiVersion: "tenancy.stigmer.ai/v1",
      kind: "Organization",
      metadata: { name: ORG, slug: ORG, org: "" },
      spec: { description: ORG },
    });
    // Dave provisions after the organization exists: he joins it as a member.
    await createClient(IdentityAccountCommandController, asDave()).provisionMyAccount({});
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  it("saves limited networking with packages, storing each host lower case, without a trailing dot, once", async () => {
    const created = await createClient(EnvironmentCommandController, asCarol()).create(
      environmentInput(ORG, "Fenced", {
        networking: {
          type: NetworkingType.limited,
          allowedHosts: ["API.GitHub.com.", "*.Example.com", "api.github.com", "registry.npmjs.org"],
          allowPackageManagers: true,
        },
        packages: { apt: ["jq"], npm: ["typescript@5"] },
      }),
    );
    expect(created.metadata?.id).toMatch(/^env_/);
    expect(created.spec?.networking?.type).toBe(NetworkingType.limited);
    expect(created.spec?.networking?.allowedHosts).toEqual(["api.github.com", "*.example.com", "registry.npmjs.org"]);
    expect(created.spec?.packages?.apt).toEqual(["jq"]);
  });

  it("re-runs the host refusal and the normalization on update", async () => {
    const carol = createClient(EnvironmentCommandController, asCarol());
    const created = await carol.create(
      environmentInput(ORG, "Narrow", {
        networking: { type: NetworkingType.limited, allowedHosts: ["api.github.com"] },
      }),
    );
    const refused = await errorOf(() =>
      carol.update({
        resource: withSpec(created, {
          networking: { type: NetworkingType.limited, allowedHosts: ["10.0.0.1"] },
        }),
        updateMask: { paths: ["spec"] },
      }),
    );
    expect(refused.code).toBe(Code.InvalidArgument);
    expect(refused.rawMessage).toContain("'10.0.0.1' is an IP address");

    const updated = await carol.update({
      resource: withSpec(created, {
        networking: { type: NetworkingType.limited, allowedHosts: ["PyPI.org.", "pypi.org"] },
      }),
      updateMask: { paths: ["spec"] },
    });
    expect(updated.spec?.networking?.allowedHosts).toEqual(["pypi.org"]);
  });

  it("refuses a member who is not an admin, and lets the admin create", async () => {
    const refused = await errorOf(() =>
      createClient(EnvironmentCommandController, asDave()).create(environmentInput(ORG, "Daves Box")),
    );
    expect(refused.code).toBe(Code.PermissionDenied);
    const carols = await createClient(EnvironmentCommandController, asCarol()).create(
      environmentInput(ORG, "Carols Box"),
    );
    expect(carols.metadata?.slug).toBe("carols-box");
    const listed = await createClient(EnvironmentQueryController, asCarol()).list({ org: ORG });
    const slugs = listed.entries.map((entry) => entry.metadata?.slug);
    expect(slugs).toContain("carols-box");
    expect(slugs).not.toContain("daves-box");
  });
});
