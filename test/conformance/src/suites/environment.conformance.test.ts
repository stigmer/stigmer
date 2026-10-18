// Environment conformance — the kind's contract on every edition (Class A).
// Domain: conformance suites.
//
// An Environment is a named sandbox setup: the packages a conversation's
// sandboxes get and the hosts they may reach, shaped as Claude Managed
// Agents' environment config. What a server can enforce depends on its
// sandbox driver, so this suite asks only what every edition answers alike:
//
//   - CRUD and identity over an unrestricted Environment with no packages:
//     an env_ id, networking read back as unrestricted when none was given,
//     the organization's default visibility, get / getByReference / list,
//     a masked update, apply by slug, updateVisibility, delete;
//   - the grammar, judged before the driver is asked: a host that names the
//     cluster, a metadata service, an address or a single label is refused
//     INVALID_ARGUMENT naming it, and hosts or flags under unrestricted
//     networking are refused by the contract itself;
//   - the delete guard: an Environment an agent names as its default is not
//     deleted, the refusal names the agent, and removing the default frees it.
//
// Rename is the shared rename table's (rename.conformance.test.ts).
import { Code } from "@connectrpc/connect";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { NetworkingType } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/apis/ai/stigmer/commons/apiresource/enum_pb";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { makeAgent, makeAgentSpec } from "../support/agents";
import { makeEnvironment, makeLimitedEnvironment } from "../support/environments";
import { uniqueName } from "../support/naming";
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

async function createEnvironment(org: string, name = uniqueName("env")) {
  const environment = await clients.environmentCommand.create(makeEnvironment(org, name));
  const id = environment.metadata!.id;
  fixtures.defer(() => clients.environmentCommand.delete({ value: id }).catch(() => undefined));
  return environment;
}

describe("Environment conformance — CRUD & identity", () => {
  it("[rpc:EnvironmentCommandController.create] create assigns an env_ id, shares it with the organization, and reads networking back as unrestricted", async () => {
    const { org } = await target.provisionTenancy();
    const bare = makeEnvironment(org, uniqueName("env"));
    bare.spec = { description: "no networking given" };
    const created = await clients.environmentCommand.create(bare);
    fixtures.defer(() => clients.environmentCommand.delete({ value: created.metadata!.id }).catch(() => undefined));

    expect(created.metadata?.id).toMatch(/^env_/);
    expect(created.metadata?.org).toBe(org);
    expect(created.metadata?.visibility).toBe(ApiResourceVisibility.visibility_org);
    expect(created.spec?.networking?.type).toBe(NetworkingType.unrestricted);
  });

  it("[rpc:EnvironmentQueryController.get] [rpc:EnvironmentQueryController.getByReference] [rpc:EnvironmentQueryController.list] get, getByReference and list find it", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createEnvironment(org);
    const id = created.metadata!.id;

    expect((await clients.environmentQuery.get({ value: id })).metadata?.id).toBe(id);
    expect(
      (await clients.environmentQuery.getByReference({ org, slug: created.metadata!.slug })).metadata?.id,
    ).toBe(id);
    const listed = await clients.environmentQuery.list({ org });
    expect(listed.entries.map((e) => e.metadata?.id)).toContain(id);
  });

  it("[rpc:EnvironmentCommandController.update] update changes the masked path and keeps the rest", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createEnvironment(org);

    const updated = await clients.environmentCommand.update({
      resource: { metadata: { id: created.metadata!.id, org }, spec: { description: "edited" } },
      updateMask: { paths: ["spec.description"] },
    });
    expect(updated.spec?.description).toBe("edited");
    expect(updated.spec?.networking?.type).toBe(NetworkingType.unrestricted);
    expect(updated.metadata?.slug).toBe(created.metadata?.slug);
  });

  it("[rpc:EnvironmentCommandController.apply] apply creates by slug, then updates the same Environment", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("env");
    const first = await clients.environmentCommand.apply(makeEnvironment(org, name, "v1"));
    fixtures.defer(() => clients.environmentCommand.delete({ value: first.metadata!.id }).catch(() => undefined));
    const second = await clients.environmentCommand.apply(makeEnvironment(org, name, "v2"));

    expect(second.metadata?.id).toBe(first.metadata?.id);
    expect(second.spec?.description).toBe("v2");
  });

  it("[rpc:EnvironmentCommandController.updateVisibility] updateVisibility narrows it to private", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createEnvironment(org);

    const narrowed = await clients.environmentCommand.updateVisibility({
      resourceId: created.metadata!.id,
      visibility: ApiResourceVisibility.visibility_private,
    });
    expect(narrowed.metadata?.visibility).toBe(ApiResourceVisibility.visibility_private);
  });

  it("[rpc:EnvironmentCommandController.delete] delete removes it", async () => {
    const { org } = await target.provisionTenancy();
    const created = await clients.environmentCommand.create(makeEnvironment(org, uniqueName("env")));

    const deleted = await clients.environmentCommand.delete({ value: created.metadata!.id });
    expect(deleted.metadata?.id).toBe(created.metadata?.id);
    await expectGrpcCode(
      () => clients.environmentQuery.get({ value: created.metadata!.id }),
      Code.NotFound,
      "a deleted Environment is gone",
    );
  });
});

describe("Environment conformance — the grammar", () => {
  it.each([
    ["the cluster's own names", "api.default.svc"],
    ["a metadata service", "metadata.google.internal"],
    ["an address", "10.0.0.1"],
    ["a single label", "router"],
  ])("[rpc:EnvironmentCommandController.create] a host that is %s is refused, named", async (_what, host) => {
    const { org } = await target.provisionTenancy();
    const error = await expectGrpcCode(
      () => clients.environmentCommand.create(makeLimitedEnvironment(org, uniqueName("env"), [host])),
      Code.InvalidArgument,
      `the host ${host}`,
    );
    expect(error.rawMessage).toContain(host);
  });

  it("[rpc:EnvironmentCommandController.create] hosts under unrestricted networking are refused by the contract", async () => {
    const { org } = await target.provisionTenancy();
    const environment = makeEnvironment(org, uniqueName("env"));
    environment.spec = { networking: { type: NetworkingType.unrestricted, allowedHosts: ["api.github.com"] } };
    await expectGrpcCode(
      () => clients.environmentCommand.create(environment),
      Code.InvalidArgument,
      "hosts apply only when networking is limited",
    );
  });

  it("[rpc:EnvironmentCommandController.create] a package that names a URL is refused by the contract", async () => {
    const { org } = await target.provisionTenancy();
    const environment = makeEnvironment(org, uniqueName("env"));
    environment.spec = { networking: { type: NetworkingType.unrestricted }, packages: { pip: ["git+https://example.com/x.git"] } };
    await expectGrpcCode(
      () => clients.environmentCommand.create(environment),
      Code.InvalidArgument,
      "a package is a registry name, never a source",
    );
  });
});

describe("Environment conformance — the delete guard", () => {
  it("[rpc:EnvironmentCommandController.delete] an Environment an agent names as its default is not deleted until the agent stops naming it", async () => {
    const { org } = await target.provisionTenancy();
    const environment = await createEnvironment(org);
    const agentInput = makeAgent({ org, name: uniqueName("agent") });
    agentInput.spec = {
      ...makeAgentSpec(),
      environmentRef: { kind: ApiResourceKind.environment, org, slug: environment.metadata!.slug },
    };
    const agent = await clients.agentCommand.create(agentInput);
    fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }).catch(() => undefined));

    const error = await expectGrpcCode(
      () => clients.environmentCommand.delete({ value: environment.metadata!.id }),
      Code.FailedPrecondition,
      "an agent's default is in use",
    );
    expect(error.rawMessage).toContain(agent.metadata!.slug);

    await clients.agentCommand.update({
      resource: { metadata: { id: agent.metadata!.id, org }, spec: { ...makeAgentSpec() } },
      updateMask: { paths: ["spec.environment_ref"] },
    });
    const deleted = await clients.environmentCommand.delete({ value: environment.metadata!.id });
    expect(deleted.metadata?.id).toBe(environment.metadata?.id);
  });
});
