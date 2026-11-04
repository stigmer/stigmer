/**
 * Pins AdmitRoutineRun (../admit-run.ts): a routine whose fires'
 * conversations would be refused when made is refused when it is saved,
 * with the sentence that conversation's create answers
 * (stigmer/stigmer#2832), and the conversation it asks of is the one a fire
 * sends (../fired-session.ts).
 *
 * Over a real SQLite store, the governing and local-only policy doubles and
 * the real RequestContext:
 *   - under a governing policy: an agent MCP server whose host the routine's
 *     limited Environment does not list is refused with
 *     unlistedMcpHostMessage, and passes when the Environment allows its MCP
 *     servers or lists the host; a git repository it does not reach is
 *     refused with unlistedRepositoryHostMessage; limited networking the
 *     driver cannot enforce is refused with the unservable sentence;
 *   - the Environment is resolved as at a fire: the agent version's default
 *     and the organization's default are reached when the routine names
 *     none, and the agent tree is read at the version the routine names (a
 *     tag without the server passes where the head would be refused);
 *   - where the policy does not govern, a routine naming an Environment is
 *     refused with LOCAL_ENVIRONMENT_MESSAGE, and one naming none passes
 *     without its agent tree being read;
 *   - where the sandbox cannot start a local program, an agent whose plugin
 *     runs one is refused naming the plugin, and one with none passes;
 *     elsewhere it passes;
 *   - a version the agent does not hold is refused with
 *     agentVersionNotFoundMessage on every server;
 *   - the step asks a create always, and an update only when it changes the
 *     agent, its version, the resources or the Environment, or turns the
 *     routine back on: a rename, an every-path echo, a harness change and
 *     disabling a broken routine pass; a resources edit, an Environment
 *     edit, a version edit and re-enabling a broken one are refused;
 *   - routineSessionSpec is the conversation a fire sends: the agent at the
 *     routine's version, the routine's name (else slug) as subject, its
 *     resources, harness only when set, its Environment only when named.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { clone, create } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { EnvironmentSchema } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/api_pb";
import type { Environment } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/api_pb";
import { NetworkingType } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/spec_pb";
import type { EnvironmentSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/spec_pb";
import { PluginSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import { RoutineSchema } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import type { Routine } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { OrganizationSchema } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";

import type { Authorizer } from "../../../extensions/authorizer.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../../pipeline/steps/load-existing.js";
import type { EnvironmentSupport } from "../../../sandbox/provisioner.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import type { Store } from "../../../store/interface.js";
import { namingSaves } from "../../../store/__tests__/named-saves.js";
import { unservableReason } from "../../environment/facts.js";
import {
  LOCAL_ENVIRONMENT_MESSAGE,
  unlistedMcpHostMessage,
  unlistedRepositoryHostMessage,
} from "../../run/environment-admission.js";
import type { EnvironmentPolicy } from "../../run/environment-admission.js";
import type { LocalProgramPolicy } from "../../run/local-programs.js";
import { agentVersionNotFoundMessage } from "../../session/constants.js";
import { admitRoutineRun, newAdmitRoutineRunStep } from "../admit-run.js";
import type { RoutineRunAdmissionDeps } from "../admit-run.js";
import { routineSessionSpec } from "../fired-session.js";

const ORG = "org_1";
const OTHER_ORG = "org_2";
const HEAD = "a".repeat(64);
const OLDER = "b".repeat(64);
const FULL: EnvironmentSupport = { limitedNetworking: true, packages: true };

function governing(support: EnvironmentSupport = FULL): EnvironmentPolicy {
  return { governs: () => true, support };
}
const LOCAL_ONLY: EnvironmentPolicy = { governs: () => false, support: FULL };
const SANDBOX_REFUSES: LocalProgramPolicy = {
  refusesLocalPrograms: () => true,
};
const SANDBOX_STARTS: LocalProgramPolicy = {
  refusesLocalPrograms: () => false,
};
const ALLOW_ALL: Authorizer = { authorize: async () => ({ kind: "allow" }) };

function environment(
  id: string,
  slug: string,
  spec: MessageInitShape<typeof EnvironmentSpecSchema>,
  org = ORG,
): Environment {
  return create(EnvironmentSchema, { metadata: { id, org, slug }, spec });
}

const BOX = environment("env_01box", "box", {
  networking: {
    type: NetworkingType.limited,
    allowedHosts: ["api.github.com", "*.linear.app"],
  },
});

function envRef(id: string, org = ORG) {
  return { kind: ApiResourceKind.environment, org, id };
}

function routine(opts: {
  agent?: string;
  agentSlug?: string;
  org?: string;
  version?: string;
  environment?: string;
  repositories?: string[];
  enabled?: boolean;
  harness?: Harness;
}): Routine {
  const org = opts.org ?? ORG;
  return create(RoutineSchema, {
    metadata: { id: "rtn_1", org, slug: "daily", name: "Daily" },
    spec: {
      enabled: opts.enabled ?? true,
      agent: {
        agentRef: {
          kind: ApiResourceKind.agent,
          org,
          id: opts.agent ?? "agt_plain",
          slug: opts.agentSlug ?? "plain",
          version: opts.version ?? "",
        },
        message: "report",
        harness: opts.harness ?? Harness.UNSPECIFIED,
        ...(opts.environment === undefined
          ? {}
          : { environmentRef: envRef(opts.environment, org) }),
        resources: (opts.repositories ?? []).map((url, index) => ({
          name: `repo${index}`,
          resource: { case: "gitRepository" as const, value: { url } },
        })),
      },
    },
  });
}

async function refusal(promise: Promise<unknown>): Promise<ConnectError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ConnectError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected a refusal");
}

let dir: string;
let store: Store;

function deps(
  environmentPolicy: EnvironmentPolicy = governing(),
  localPrograms: LocalProgramPolicy = SANDBOX_STARTS,
  over: Store = store,
): RoutineRunAdmissionDeps {
  return {
    store: over,
    authorizer: ALLOW_ALL,
    environmentPolicy,
    localPrograms,
  };
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "admit-routine-run-test-"));
  store = namingSaves(SqliteStore.open(path.join(dir, "stigmer.db")));
  for (const env of [
    BOX,
    environment("env_01open", "open", {
      networking: {
        type: NetworkingType.limited,
        allowedHosts: ["api.github.com"],
        allowMcpServers: true,
      },
    }),
    environment("env_01wide", "wide", {
      networking: {
        type: NetworkingType.limited,
        allowedHosts: ["search.example.org", "gitlab.com"],
      },
    }),
    environment(
      "env_02box",
      "box",
      {
        networking: {
          type: NetworkingType.limited,
          allowedHosts: ["api.github.com"],
        },
      },
      OTHER_ORG,
    ),
  ]) {
    await store.saveResource(
      ApiResourceKind.environment,
      env.metadata?.id ?? "",
      EnvironmentSchema,
      env,
    );
  }
  await store.saveResource(
    ApiResourceKind.organization,
    OTHER_ORG,
    OrganizationSchema,
    create(OrganizationSchema, {
      metadata: { id: OTHER_ORG, slug: "other" },
      spec: {
        preferences: { defaultEnvironmentRef: envRef("env_02box", OTHER_ORG) },
      },
    }),
  );
  await store.saveResource(
    ApiResourceKind.plugin,
    "plg_files",
    PluginSchema,
    create(PluginSchema, {
      metadata: { id: "plg_files", org: ORG, slug: "files", name: "files" },
      status: {
        digest: HEAD,
        mcpServers: [
          {
            name: "files-local",
            transport: { case: "stdio", value: { command: "npx" } },
          },
        ],
      },
    }),
  );
  const agents: {
    id: string;
    slug: string;
    org?: string;
    spec: MessageInitShape<typeof AgentSchema>["spec"];
  }[] = [
    { id: "agt_plain", slug: "plain", spec: {} },
    // The head dials an MCP server; the version tagged v1 dials none.
    {
      id: "agt_search",
      slug: "search",
      spec: {
        mcpServers: [{ name: "search", url: "https://search.example.org/mcp" }],
      },
    },
    {
      id: "agt_default",
      slug: "defaulted",
      spec: {
        environmentRef: envRef("env_01box"),
        mcpServers: [{ name: "search", url: "https://search.example.org/mcp" }],
      },
    },
    {
      id: "agt_local",
      slug: "local",
      spec: { plugins: [{ org: ORG, slug: "files" }] },
    },
    {
      id: "agt_far",
      slug: "far",
      org: OTHER_ORG,
      spec: {
        mcpServers: [{ name: "far", url: "https://far.example.org/mcp" }],
      },
    },
  ];
  for (const agent of agents) {
    await store.saveResource(
      ApiResourceKind.agent,
      agent.id,
      AgentSchema,
      create(AgentSchema, {
        metadata: { id: agent.id, org: agent.org ?? ORG, slug: agent.slug },
        spec: agent.spec,
        status: { versionHash: HEAD },
      }),
    );
  }
  await store.saveAudit(
    ApiResourceKind.agent,
    "agt_search",
    AgentSchema,
    create(AgentSchema, {
      metadata: { id: "agt_search", org: ORG, slug: "search" },
      spec: {},
      status: { versionHash: OLDER },
    }),
    OLDER,
    "v1",
  );
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("admitRoutineRun under a governing policy", () => {
  it("refuses an agent MCP server whose host the routine's limited Environment does not list", async () => {
    const error = await refusal(
      admitRoutineRun(
        deps(),
        routine({
          agent: "agt_search",
          agentSlug: "search",
          environment: "env_01box",
        }),
        testCallerIdentity(),
      ),
    );
    expect(error.code).toBe(Code.FailedPrecondition);
    expect(error.rawMessage).toBe(
      unlistedMcpHostMessage("box", "search", "search.example.org"),
    );
  });

  it("admits it when the Environment allows its MCP servers or lists the host", async () => {
    for (const env of ["env_01open", "env_01wide"]) {
      await admitRoutineRun(
        deps(),
        routine({ agent: "agt_search", agentSlug: "search", environment: env }),
        testCallerIdentity(),
      );
    }
  });

  it("refuses a git repository the Environment does not reach, and admits one it does", async () => {
    const error = await refusal(
      admitRoutineRun(
        deps(),
        routine({
          environment: "env_01box",
          repositories: ["https://gitlab.com/acme/app.git"],
        }),
        testCallerIdentity(),
      ),
    );
    expect(error.code).toBe(Code.FailedPrecondition);
    expect(error.rawMessage).toBe(
      unlistedRepositoryHostMessage("box", "gitlab.com/acme/app.git", [
        "gitlab.com",
      ]),
    );
    await admitRoutineRun(
      deps(),
      routine({
        environment: "env_01wide",
        repositories: ["https://gitlab.com/acme/app.git"],
      }),
      testCallerIdentity(),
    );
  });

  it("refuses limited networking the driver cannot enforce", async () => {
    const support: EnvironmentSupport = {
      limitedNetworking: false,
      packages: true,
    };
    const error = await refusal(
      admitRoutineRun(
        deps(governing(support)),
        routine({ environment: "env_01box" }),
        testCallerIdentity(),
      ),
    );
    expect(error.code).toBe(Code.FailedPrecondition);
    expect(error.rawMessage).toBe(unservableReason(support, BOX));
  });

  it("reaches the agent version's default Environment when the routine names none", async () => {
    const error = await refusal(
      admitRoutineRun(
        deps(),
        routine({ agent: "agt_default", agentSlug: "defaulted" }),
        testCallerIdentity(),
      ),
    );
    expect(error.rawMessage).toBe(
      unlistedMcpHostMessage("box", "search", "search.example.org"),
    );
  });

  it("reaches the organization's default Environment when neither the routine nor its agent names one", async () => {
    const error = await refusal(
      admitRoutineRun(
        deps(),
        routine({ org: OTHER_ORG, agent: "agt_far", agentSlug: "far" }),
        testCallerIdentity(),
      ),
    );
    expect(error.rawMessage).toBe(
      unlistedMcpHostMessage("box", "far", "far.example.org"),
    );
  });

  it("reads the agent tree at the version the routine names, not the head", async () => {
    await admitRoutineRun(
      deps(),
      routine({
        agent: "agt_search",
        agentSlug: "search",
        version: "v1",
        environment: "env_01box",
      }),
      testCallerIdentity(),
    );
  });

  it("admits a routine whose conversation has no Environment", async () => {
    await admitRoutineRun(
      deps(),
      routine({ agent: "agt_search", agentSlug: "search" }),
      testCallerIdentity(),
    );
  });
});

describe("admitRoutineRun where no server-started sandbox runs its fires", () => {
  it("refuses a routine naming an Environment with the conversation's own sentence", async () => {
    const error = await refusal(
      admitRoutineRun(
        deps(LOCAL_ONLY),
        routine({ environment: "env_01box" }),
        testCallerIdentity(),
      ),
    );
    expect(error.code).toBe(Code.FailedPrecondition);
    expect(error.rawMessage).toBe(LOCAL_ENVIRONMENT_MESSAGE);
  });

  it("admits one naming none without reading its agent tree", async () => {
    const kindsRead: ApiResourceKind[] = [];
    const counting = new Proxy(store, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver) as unknown;
        if (typeof value !== "function") {
          return value;
        }
        return (...args: unknown[]) => {
          kindsRead.push(args[0] as ApiResourceKind);
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    });
    await admitRoutineRun(
      deps(LOCAL_ONLY, SANDBOX_STARTS, counting),
      routine({ agent: "agt_local", agentSlug: "local" }),
      testCallerIdentity(),
    );
    expect(kindsRead).toContain(ApiResourceKind.agent);
    expect(kindsRead).not.toContain(ApiResourceKind.plugin);
  });
});

describe("admitRoutineRun's local-program rule", () => {
  it("refuses an agent whose plugin runs a local program where the sandbox cannot start one", async () => {
    const error = await refusal(
      admitRoutineRun(
        deps(LOCAL_ONLY, SANDBOX_REFUSES),
        routine({ agent: "agt_local", agentSlug: "local" }),
        testCallerIdentity(),
      ),
    );
    expect(error.code).toBe(Code.FailedPrecondition);
    expect(error.rawMessage).toContain(
      "plugin 'files' runs its MCP server 'files-local' as a local program",
    );
  });

  it("admits an agent with no local program there, when its conversation has no Environment", async () => {
    await admitRoutineRun(
      deps(LOCAL_ONLY, SANDBOX_REFUSES),
      routine({}),
      testCallerIdentity(),
    );
  });

  it("admits it where the sandbox starts one", async () => {
    await admitRoutineRun(
      deps(governing(), SANDBOX_STARTS),
      routine({ agent: "agt_local", agentSlug: "local" }),
      testCallerIdentity(),
    );
  });
});

describe("admitRoutineRun's agent version", () => {
  it("refuses a version the agent does not hold, on every server", async () => {
    for (const policy of [governing(), LOCAL_ONLY]) {
      const error = await refusal(
        admitRoutineRun(
          deps(policy),
          routine({ agent: "agt_search", agentSlug: "search", version: "v9" }),
          testCallerIdentity(),
        ),
      );
      expect(error.code).toBe(Code.FailedPrecondition);
      expect(error.rawMessage).toBe(
        agentVersionNotFoundMessage(ORG, "search", "v9"),
      );
    }
  });
});

describe("the AdmitRoutineRun step", () => {
  const BROKEN = {
    agent: "agt_search",
    agentSlug: "search",
    environment: "env_01box",
  };

  async function run(next: Routine, stored?: Routine): Promise<void> {
    const ctx = new RequestContext(
      RoutineSchema,
      next,
      testCallerIdentity(),
      ApiResourceKind.routine,
    );
    if (stored !== undefined) {
      ctx.set(EXISTING_RESOURCE_KEY, stored);
    }
    await newAdmitRoutineRunStep(deps()).execute(ctx);
  }

  it("asks every create", async () => {
    const error = await refusal(run(routine(BROKEN)));
    expect(error.rawMessage).toBe(
      unlistedMcpHostMessage("box", "search", "search.example.org"),
    );
  });

  it("passes an update that leaves what a fire runs in alone", async () => {
    const stored = routine(BROKEN);
    const renamed = clone(RoutineSchema, stored);
    if (renamed.metadata !== undefined) {
      renamed.metadata.name = "Renamed";
    }
    await run(renamed, stored);
    await run(clone(RoutineSchema, stored), stored);
    await run(routine({ ...BROKEN, harness: Harness.CLAUDE }), stored);
    await run(routine({ ...BROKEN, enabled: false }), stored);
    await run(
      routine({ ...BROKEN, enabled: false }),
      routine({ ...BROKEN, enabled: false }),
    );
  });

  it("asks an update that changes the resources, the Environment or the version", async () => {
    const fine = routine({ environment: "env_01box" });
    const resources = await refusal(
      run(
        routine({
          environment: "env_01box",
          repositories: ["https://gitlab.com/acme/app.git"],
        }),
        fine,
      ),
    );
    expect(resources.rawMessage).toBe(
      unlistedRepositoryHostMessage("box", "gitlab.com/acme/app.git", [
        "gitlab.com",
      ]),
    );

    const unbound = routine({ agent: "agt_search", agentSlug: "search" });
    const environmentEdit = await refusal(run(routine(BROKEN), unbound));
    expect(environmentEdit.rawMessage).toBe(
      unlistedMcpHostMessage("box", "search", "search.example.org"),
    );

    const pinned = routine({ ...BROKEN, version: "v1" });
    const versionEdit = await refusal(run(routine(BROKEN), pinned));
    expect(versionEdit.rawMessage).toBe(
      unlistedMcpHostMessage("box", "search", "search.example.org"),
    );
  });

  it("asks an update that turns a routine back on", async () => {
    const error = await refusal(
      run(routine(BROKEN), routine({ ...BROKEN, enabled: false })),
    );
    expect(error.rawMessage).toBe(
      unlistedMcpHostMessage("box", "search", "search.example.org"),
    );
  });
});

describe("routineSessionSpec", () => {
  it("is the conversation a fire sends", () => {
    const spec = routineSessionSpec(
      routine({
        version: "v1",
        environment: "env_01box",
        harness: Harness.CLAUDE,
        repositories: ["https://github.com/acme/api"],
      }),
      { org: ORG, id: "agt_plain" },
    );
    expect(spec.agentRef).toMatchObject({
      kind: ApiResourceKind.agent,
      org: ORG,
      id: "agt_plain",
      version: "v1",
    });
    expect(spec.subject).toBe("Daily");
    expect(spec.harness).toBe(Harness.CLAUDE);
    expect(spec.environmentRef?.id).toBe("env_01box");
    expect(spec.resources).toHaveLength(1);

    const bare = routine({});
    if (bare.metadata !== undefined) {
      bare.metadata.name = "";
    }
    const plain = routineSessionSpec(bare, { org: ORG, id: "agt_plain" });
    expect(plain.subject).toBe("daily");
    expect(plain.harness).toBe(Harness.UNSPECIFIED);
    expect(plain.environmentRef).toBeUndefined();
  });
});
