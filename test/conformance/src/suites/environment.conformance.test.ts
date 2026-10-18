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
//     cluster, a metadata service or an address is refused INVALID_ARGUMENT
//     naming it, a single label by the contract's pattern naming the field, and hosts or flags under unrestricted
//     networking are refused by the contract itself;
//   - the delete guard: an Environment an agent names as its default is not
//     deleted, the refusal names the agent, and removing the default frees it;
//   - server info tells the truth: what getServerInfo's `environments` says
//     the server's sandboxes can do and govern is exactly what its refusals
//     say. A limited save is refused exactly when it says limited networking
//     is not available, a save with packages exactly when packages are not,
//     and a conversation that names an Environment and no target is refused
//     as one on the person's own machine exactly when it says Environments
//     do not apply. Each target answers by its own sandbox driver, so the
//     advertisement cannot drift from the behaviour on any edition.
//
// Rename is the shared rename table's (rename.conformance.test.ts).
import { Code } from "@connectrpc/connect";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { NetworkingType } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/spec_pb";
import { EnvironmentSource } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/apis/ai/stigmer/commons/apiresource/enum_pb";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { agentRefOf, makeAgent, makeAgentSpec } from "../support/agents";
import { makeEnvironment, makeLimitedEnvironment } from "../support/environments";
import { uniqueName } from "../support/naming";
import { makeSession, makeSessionSpec } from "../support/sessions";
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
  // The server's own refusals name the host; a single label fails the
  // contract's pattern first, whose refusal names the field.
  it.each([
    ["the cluster's own names", "api.default.svc", "api.default.svc"],
    ["a metadata service", "metadata.google.internal", "metadata.google.internal"],
    ["an address", "10.0.0.1", "10.0.0.1"],
    ["a single label", "router", "allowed_hosts"],
  ])("[rpc:EnvironmentCommandController.create] a host that is %s is refused, naming it", async (_what, host, named) => {
    const { org } = await target.provisionTenancy();
    const error = await expectGrpcCode(
      () => clients.environmentCommand.create(makeLimitedEnvironment(org, uniqueName("env"), [host])),
      Code.InvalidArgument,
      `the host ${host}`,
    );
    expect(error.rawMessage).toContain(named);
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

describe("Environment conformance — server info tells the truth", () => {
  async function availability() {
    const info = await clients.platformQuery.getServerInfo({});
    expect(info.environments, "every server that knows the field sets it").toBeDefined();
    return info.environments!;
  }

  it("[rpc:PlatformQueryController.getServerInfo] [rpc:EnvironmentCommandController.create] a limited save is refused exactly when limited networking is not available", async () => {
    const { limitedNetworking } = await availability();
    const { org } = await target.provisionTenancy();
    const input = makeLimitedEnvironment(org, uniqueName("env"), ["api.github.com"]);
    if (!limitedNetworking) {
      const error = await expectGrpcCode(
        () => clients.environmentCommand.create(input),
        Code.FailedPrecondition,
        "the server said its sandboxes cannot limit networking",
      );
      expect(error.rawMessage).toContain("which this server's sandboxes cannot enforce");
      return;
    }
    const created = await clients.environmentCommand.create(input);
    fixtures.defer(() => clients.environmentCommand.delete({ value: created.metadata!.id }).catch(() => undefined));
    expect(created.spec?.networking?.type).toBe(NetworkingType.limited);
  });

  it("[rpc:PlatformQueryController.getServerInfo] [rpc:EnvironmentCommandController.create] a save with packages is refused exactly when packages are not available", async () => {
    const { packages } = await availability();
    const { org } = await target.provisionTenancy();
    const input = {
      ...makeEnvironment(org, uniqueName("env")),
      spec: { networking: { type: NetworkingType.unrestricted }, packages: { pip: ["requests"] } },
    };
    if (!packages) {
      const error = await expectGrpcCode(
        () => clients.environmentCommand.create(input),
        Code.FailedPrecondition,
        "the server said its sandboxes cannot install packages",
      );
      expect(error.rawMessage).toContain("installs packages, which this server's sandboxes cannot do");
      return;
    }
    const created = await clients.environmentCommand.create(input);
    fixtures.defer(() => clients.environmentCommand.delete({ value: created.metadata!.id }).catch(() => undefined));
    expect(created.spec?.packages?.pip).toEqual(["requests"]);
  });

  it("[rpc:PlatformQueryController.getServerInfo] [rpc:SessionCommandController.create] a conversation naming an Environment and no target is refused exactly when Environments do not apply", async () => {
    const { applies } = await availability();
    const { org } = await target.provisionTenancy();
    const environment = await createEnvironment(org);
    const agent = await clients.agentCommand.create(makeAgent({ org, name: uniqueName("agent") }));
    fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }).catch(() => undefined));
    const input = {
      ...makeSession({ org, name: uniqueName("session") }),
      spec: {
        ...makeSessionSpec({ agentRef: agentRefOf(agent) }),
        environmentRef: { kind: ApiResourceKind.environment, org, slug: environment.metadata!.slug },
      },
    };
    if (!applies) {
      const error = await expectGrpcCode(
        () => clients.sessionCommand.create(input),
        Code.FailedPrecondition,
        "the server said no Environment governs a conversation that names no target",
      );
      expect(error.rawMessage).toContain("where an environment does not apply");
      return;
    }
    const session = await clients.sessionCommand.create(input);
    // Registered before the Environment's own cleanup runs: the delete guard
    // never holds an Environment for a conversation, but a session left
    // behind is litter on a shared target.
    fixtures.defer(() => clients.sessionCommand.delete({ value: session.metadata!.id }).catch(() => undefined));
    expect(session.status?.environmentSource).toBe(EnvironmentSource.SESSION);
    expect(session.status?.environment?.slug).toBe(environment.metadata!.slug);
  });
});
