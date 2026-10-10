/**
 * The run value planner's ASSEMBLY test: what the planner hands the vault
 * resolver and what it records. Which login or secret fills each key is the
 * resolver's one rule, pinned in domain/vault/__tests__/resolve.test.ts;
 * here the resolver is a recording stub.
 *
 * The planner's inputs are the execution alone: the session it loads by the
 * target oneof's session id, the agent the turn's stamp names (a turn with
 * no stamp declares no agent half, whatever its session pins), at the
 * version the turn recorded (never the agent's head, so recovery after an
 * author's edit plans for what the turn ran; a recorded version that no
 * longer resolves refuses, naming it), the agent's own organization (a
 * parent organization's agent's, not the run's; none when its row cannot
 * be read), and every MCP server the run uses, the agent's and the
 * session's (a server that cannot be found is skipped; a store fault
 * reading one fails the plan; one tool name the agent and the conversation
 * use for two different servers refuses the plan, as does one side naming
 * a server that is gone, and the very same server is one tool). The plan
 * it records is exactly the resolver's source manifest, written onto the
 * run's status before Persist and nowhere else, and a resolver refusal
 * reaches the caller with its code.
 *
 * And StampRunCredentials, the create step before the planner: the run's
 * person is the platform's one rule for a first-party human operator,
 * recorded once; a schedule fire, a runner, a PlatformClient user token and
 * the server acting as itself record none, and a client-sent value (its
 * sources included) is discarded. The record survives the runner's status
 * writes, so recover reads the person and the manifest create recorded.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentVersionEntrySchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/version_pb";
import type { AgentVersionEntry } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/version_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { Run, RunValueSource } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunSchema, RunValueSourceSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase, RunValueOrigin } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { RunUpdateStatusInputSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/io_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import type { Store } from "../../../store/interface.js";
import type { RunCredentialInput } from "../../vault/resolve.js";

import type { RunValuePlannerDeps } from "../plan-run-values-step.js";
import {
  newPlanRunValuesStep,
  newStampRunCredentialsStep,
  planRunValues,
} from "../plan-run-values-step.js";
import { applyUpdateStatusMerge } from "../update-status.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const ORG = "acme";

let dir: string;
let store: Store;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "run-planner-test-"));
  store = SqliteStore.open(path.join(dir, "stigmer.db"));
  for (const slug of ["linear", "notion"]) {
    await store.saveResource(
      ApiResourceKind.mcp_server,
      `mcp_${slug}`,
      McpServerSchema,
      create(McpServerSchema, {
        metadata: { id: `mcp_${slug}`, name: slug, slug, org: ORG },
        spec: {
          serverType: {
            case: "http",
            value: { url: `https://mcp.${slug}.example/mcp` },
          },
        },
      }),
    );
  }
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** The manifest a resolver stub answers with: each key a secret by its name in one vault. */
function sources(keys: Record<string, string>): RunValueSource[] {
  return Object.entries(keys).map(([key, vaultId]) =>
    create(RunValueSourceSchema, {
      key,
      origin: RunValueOrigin.VAULT,
      vaultId,
      entry: key,
    }),
  );
}

/** Planner deps over a recording resolver; the agent loads by its recorded version. */
function deps(opts: {
  readonly session: Session;
  readonly version?: () => Promise<AgentVersionEntry>;
  readonly head?: () => Promise<ReturnType<typeof create<typeof AgentSchema>>>;
  readonly resolve?: (input: RunCredentialInput) => Promise<RunValueSource[]>;
  readonly asked: RunCredentialInput[];
  readonly store?: Store;
}): RunValuePlannerDeps {
  return {
    store: opts.store ?? store,
    logger: silentLogger,
    agentLoader: () => ({
      get: async () =>
        opts.head === undefined
          ? create(AgentSchema, {
              metadata: { id: "agt_rec", name: "Recorded Agent", org: ORG },
            })
          : opts.head(),
      getVersion: async () => {
        if (opts.version === undefined) {
          throw new Error("no version is recorded on this turn");
        }
        return opts.version();
      },
    }),
    sessionLoader: () => ({ get: async () => opts.session }),
    vaultResolver: {
      planRun: async (input) => {
        opts.asked.push(input);
        return opts.resolve === undefined ? [] : opts.resolve(input);
      },
      openRun: async () => {
        throw new Error("the planner never opens a value");
      },
      planConnect: async () => {
        throw new Error("the run planner never asks the connect lane's question");
      },
      openConnect: async () => {
        throw new Error("the planner never opens a value");
      },
    },
  };
}

const RECORDED_HASH = "e".repeat(64);

function turn(id: string, status: Record<string, unknown> = {}): Run {
  return create(RunSchema, {
    metadata: { id, org: ORG },
    spec: { target: { case: "sessionId", value: "ses_rec" }, message: "hi" },
    status,
  });
}

describe("the builder hands the resolver the run's whole picture", () => {
  it("passes the session, the recorded version's spec, the agent's name and every server the run uses, and answers the resolver's manifest", async () => {
    const asked: RunCredentialInput[] = [];
    const session = create(SessionSchema, {
      metadata: { id: "ses_rec", org: ORG },
      spec: {
        mcpServerUsages: [
          { mcpServerRef: { org: ORG, slug: "notion" } },
          { mcpServerRef: { org: ORG, slug: "no-such-server" } },
        ],
      },
    });
    const planned = await planRunValues(
      deps({
        session,
        version: async () =>
          create(AgentVersionEntrySchema, {
            versionHash: RECORDED_HASH,
            specSnapshot: {
              env: { RECORDED_KEY: { isSecret: true } },
              mcpServerUsages: [{ mcpServerRef: { org: ORG, slug: "linear" } }],
            },
          }),
        resolve: async () => sources({ RECORDED_KEY: "vlt_team" }),
        asked,
      }),
      turn("aex_assembly", { agentId: "agt_rec", agentVersionHash: RECORDED_HASH }),
    );

    expect(asked).toHaveLength(1);
    const input = asked[0]!;
    expect(input.session).toBe(session);
    expect(Object.keys(input.agentSpec?.env ?? {})).toEqual(["RECORDED_KEY"]);
    expect(input.agentName).toBe("Recorded Agent");
    expect(input.agentOrg).toBe(ORG);
    expect(input.tools.map((tool) => tool.metadata?.slug).sort()).toEqual([
      "linear",
      "notion",
    ]);
    expect(planned.map((entry) => [entry.key, entry.vaultId, entry.entry])).toEqual([
      ["RECORDED_KEY", "vlt_team", "RECORDED_KEY"],
    ]);
  });

  it("fails the plan on a store fault reading a server the run uses, rather than running without it", async () => {
    const faulty = new Proxy(store, {
      get(target, prop, receiver) {
        if (prop === "listResources") {
          return async () => {
            throw new Error("disk gone");
          };
        }
        const value = Reflect.get(target, prop, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const asked: RunCredentialInput[] = [];
    const failure = await planRunValues(
      deps({
        session: create(SessionSchema, {
          metadata: { id: "ses_rec", org: ORG },
          spec: { mcpServerUsages: [{ mcpServerRef: { org: ORG, slug: "notion" } }] },
        }),
        asked,
        store: faulty,
      }),
      turn("aex_server_fault"),
    ).catch((e: unknown) => e);
    expect((failure as Error).message).toContain("disk gone");
    expect(asked).toEqual([]);
  });

  it("looks up no server for a usage that names no tool, never matching one by an empty name", async () => {
    const asked: RunCredentialInput[] = [];
    await planRunValues(
      deps({
        session: create(SessionSchema, {
          metadata: { id: "ses_rec", org: ORG },
          spec: {
            mcpServerUsages: [
              { mcpServerRef: { org: ORG, slug: "" } },
              { mcpServerRef: { org: ORG, slug: "notion" } },
            ],
          },
        }),
        asked,
      }),
      turn("aex_unnamed_tool"),
    );
    expect(asked[0]?.tools.map((tool) => tool.metadata?.slug)).toEqual(["notion"]);
  });

  it("looks up no server by name when neither the usage nor the run names an organization", async () => {
    const asked: RunCredentialInput[] = [];
    await planRunValues(
      deps({
        session: create(SessionSchema, {
          metadata: { id: "ses_rec", org: ORG },
          spec: { mcpServerUsages: [{ mcpServerRef: { slug: "notion" } }] },
        }),
        asked,
      }),
      create(RunSchema, {
        metadata: { id: "aex_no_org" },
        spec: { target: { case: "sessionId", value: "ses_rec" }, message: "hi" },
      }),
    );
    expect(asked[0]?.tools, "never another organization's tool of that name").toEqual([]);
  });

  it("gives the agent's own organization, not the run's, when the agent belongs to another (a parent organization's agent)", async () => {
    const parentAgent = async () =>
      create(AgentSchema, {
        metadata: { id: "agt_rec", name: "Parent Agent", org: "parent-org" },
      });
    for (const [id, status, version] of [
      ["aex_parent_head", { agentId: "agt_rec" }, undefined],
      [
        "aex_parent_recorded",
        { agentId: "agt_rec", agentVersionHash: RECORDED_HASH },
        async () =>
          create(AgentVersionEntrySchema, { versionHash: RECORDED_HASH, specSnapshot: {} }),
      ],
    ] as const) {
      const asked: RunCredentialInput[] = [];
      await planRunValues(
        deps({
          session: create(SessionSchema, { metadata: { id: "ses_rec", org: ORG } }),
          head: parentAgent,
          version,
          asked,
          }),
        turn(id, status),
      );
      expect(asked[0]?.agentName, id).toBe("Parent Agent");
      expect(asked[0]?.agentOrg, id).toBe("parent-org");
    }
  });

  it("names the agent by its id, and gives no organization, when its current row cannot be read", async () => {
    const asked: RunCredentialInput[] = [];
    await planRunValues(
      deps({
        session: create(SessionSchema, { metadata: { id: "ses_rec", org: ORG } }),
        version: async () =>
          create(AgentVersionEntrySchema, { versionHash: RECORDED_HASH, specSnapshot: {} }),
        head: async () => {
          throw new Error("the agent row is gone");
        },
        asked,
      }),
      turn("aex_nameless", { agentId: "agt_rec", agentVersionHash: RECORDED_HASH }),
    );
    expect(asked[0]?.agentName).toBe("agt_rec");
    expect(asked[0]?.agentOrg).toBeUndefined();
  });

  it("declares no agent half for a turn with no stamp, whatever its session pins", async () => {
    const asked: RunCredentialInput[] = [];
    await planRunValues(
      deps({
        session: create(SessionSchema, {
          metadata: { id: "ses_rec", org: ORG },
          spec: { agentRef: { org: ORG, slug: "pinned-agent" } },
          status: { agentId: "agt_pinned" },
        }),
        head: async () => {
          throw new Error("an unstamped turn loads no agent");
        },
        asked,
      }),
      turn("aex_unstamped"),
    );
    expect(asked[0]?.agentSpec).toBeUndefined();
    expect(asked[0]?.agentName).toBe("");
  });

  it("a resolver refusal reaches the caller with its code", async () => {
    const failure = await planRunValues(
      deps({
        session: create(SessionSchema, { metadata: { id: "ses_rec", org: ORG } }),
        resolve: async () => {
          throw new ConnectError(
            "Linear needs LINEAR_API_KEY: add LINEAR_API_KEY to My vault",
            Code.FailedPrecondition,
          );
        },
        asked: [],
      }),
      turn("aex_refused"),
    ).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ConnectError);
    expect((failure as ConnectError).code).toBe(Code.FailedPrecondition);
  });

  it("refuses a turn with no session id before reading anything", async () => {
    const asked: RunCredentialInput[] = [];
    const failure = await planRunValues(
      {
        ...deps({
          session: create(SessionSchema, {}),
          asked,
        }),
        sessionLoader: () => ({
          get: async () => {
            throw new Error("a turn with no session id reads no session");
          },
        }),
      },
      create(RunSchema, { metadata: { id: "aex_no_session", org: ORG } }),
    ).catch((e: unknown) => e);
    expect((failure as Error).message).toBe(
      "resolve session: no session_id on execution",
    );
    expect(asked).toEqual([]);
  });
});

describe("a tool name the agent and the conversation both use", () => {
  const OTHER_ORG = "elsewhere";

  beforeAll(async () => {
    await store.saveResource(
      ApiResourceKind.mcp_server,
      "mcp_linear_elsewhere",
      McpServerSchema,
      create(McpServerSchema, {
        metadata: { id: "mcp_linear_elsewhere", name: "linear", slug: "linear", org: OTHER_ORG },
        spec: {
          serverType: { case: "http", value: { url: "https://mcp.elsewhere.example/mcp" } },
        },
      }),
    );
  });

  /** A turn whose agent uses `agentRef` and whose conversation uses `sessionRef`. */
  function both(
    agentRef: { org: string; slug: string },
    sessionRef: { org: string; slug: string },
    asked: RunCredentialInput[],
  ): Promise<RunValueSource[]> {
    return planRunValues(
      deps({
        session: create(SessionSchema, {
          metadata: { id: "ses_rec", org: ORG },
          spec: { mcpServerUsages: [{ mcpServerRef: sessionRef }] },
        }),
        version: async () =>
          create(AgentVersionEntrySchema, {
            versionHash: RECORDED_HASH,
            specSnapshot: { mcpServerUsages: [{ mcpServerRef: agentRef }] },
          }),
        asked,
      }),
      turn("aex_same_name", { agentId: "agt_rec", agentVersionHash: RECORDED_HASH }),
    );
  }

  it("refuses the run when the name points at two different servers, naming it, before asking for any value", async () => {
    // The runner keeps the conversation's server under a shared name, so a
    // login planned for the agent's server would reach another one.
    const asked: RunCredentialInput[] = [];
    const failure = await both(
      { org: ORG, slug: "linear" },
      { org: OTHER_ORG, slug: "linear" },
      asked,
    ).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ConnectError);
    expect((failure as ConnectError).code).toBe(Code.FailedPrecondition);
    expect((failure as ConnectError).rawMessage).toContain("'linear'");
    expect((failure as ConnectError).rawMessage).toContain("remove");
    expect(asked).toEqual([]);
  });

  it("refuses when one side names a server that is gone: the conversation's would run unplanned", async () => {
    for (const [agentRef, sessionRef] of [
      [{ org: ORG, slug: "linear" }, { org: "nowhere", slug: "linear" }],
      [{ org: "nowhere", slug: "linear" }, { org: ORG, slug: "linear" }],
    ] as const) {
      const asked: RunCredentialInput[] = [];
      const failure = await both(agentRef, sessionRef, asked).catch((e: unknown) => e);
      expect((failure as ConnectError).code).toBe(Code.FailedPrecondition);
      expect((failure as ConnectError).rawMessage).toContain("nowhere/linear");
      expect(asked).toEqual([]);
    }
  });

  it("uses the server once when both name the very same one", async () => {
    const asked: RunCredentialInput[] = [];
    await both({ org: ORG, slug: "linear" }, { org: "", slug: "linear" }, asked);
    expect(asked[0]?.tools.map((tool) => tool.metadata?.id)).toEqual(["mcp_linear"]);
  });
});

describe("the agent the turn recorded", () => {
  const session = create(SessionSchema, { metadata: { id: "ses_rec", org: ORG } });

  it("refuses, naming the version, when the recorded version no longer resolves", async () => {
    const failure = await planRunValues(
      deps({
        session,
        version: async () => {
          throw new ConnectError("agent version not found", Code.NotFound);
        },
        asked: [],
      }),
      turn("aex_gone", { agentId: "agt_rec", agentVersionHash: RECORDED_HASH }),
    ).catch((e: unknown) => e);
    expect((failure as ConnectError).code).toBe(Code.NotFound);
    expect((failure as ConnectError).rawMessage).toContain(RECORDED_HASH);
  });

  it("keeps a recorded-version load failure that is not a status as its message, naming the version", async () => {
    const failure = await planRunValues(
      deps({
        session,
        version: async () => {
          throw new Error("socket hang up");
        },
        asked: [],
      }),
      turn("aex_fault", { agentId: "agt_rec", agentVersionHash: RECORDED_HASH }),
    ).catch((e: unknown) => e);
    expect((failure as Error).message).toContain(RECORDED_HASH);
    expect((failure as Error).message).toContain("socket hang up");
  });

  it("loads a turn that recorded its agent without a version as the agent is now, keeping a refusal's code", async () => {
    const failure = await planRunValues(
      deps({
        session,
        head: async () => {
          throw new ConnectError("agent not found", Code.NotFound);
        },
        asked: [],
      }),
      turn("aex_unversioned", { agentId: "agt_rec" }),
    ).catch((e: unknown) => e);
    expect((failure as ConnectError).code).toBe(Code.NotFound);
    expect((failure as ConnectError).rawMessage).toContain("load agent agt_rec");
  });

  it("keeps a head-load failure that is not a status as its message, for a turn that recorded no version", async () => {
    const failure = await planRunValues(
      deps({
        session,
        head: async () => {
          throw new Error("socket hang up");
        },
        asked: [],
      }),
      turn("aex_unversioned_fault", { agentId: "agt_rec" }),
    ).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(ConnectError);
    expect((failure as Error).message).toBe("load agent agt_rec: socket hang up");
  });
});

describe("StampRunCredentials", () => {
  async function stamped(
    caller: CallerIdentity,
    sent?: { person?: string; sources?: RunValueSource[] },
  ): Promise<Run> {
    const execution = create(RunSchema, {
      metadata: { id: "aex_stamp", org: ORG },
      status: sent === undefined ? {} : { credentials: sent },
    });
    const ctx = new RequestContext(RunSchema, execution, caller, ApiResourceKind.run);
    await newStampRunCredentialsStep().execute(ctx);
    return ctx.newState;
  }

  it("records a first-party human operator as the run's person", async () => {
    const run = await stamped(testCallerIdentity({ identityId: "ida_ana" }));
    expect(run.status?.credentials?.person).toBe("ida_ana");
  });

  it("records no person for a runner, a machine, the server itself or an in-process call, and discards a client-sent one", async () => {
    for (const caller of [
      testCallerIdentity({ identityId: "ida_runner", callerClass: "runner" }),
      testCallerIdentity({ identityId: "ida_machine", callerClass: "machine" }),
      testCallerIdentity({ identityId: "system", callerClass: "internal" }),
      { ...testCallerIdentity({ identityId: "ida_fire" }), origin: "in-process" as const },
    ]) {
      const run = await stamped(caller, { person: "ida_forged" });
      expect(run.status?.credentials).toBeDefined();
      expect(run.status?.credentials?.person).toBeUndefined();
    }
  });

  it("discards a client-sent manifest: a caller cannot name the vault entries its run fetches", async () => {
    const run = await stamped(testCallerIdentity({ identityId: "ida_ana" }), {
      sources: sources({ STOLEN_KEY: "vlt_someone_elses" }),
    });
    expect(run.status?.credentials?.sources).toEqual([]);
  });
});

describe("PlanRunValues, the create step", () => {
  async function planned(): Promise<{ run: Run; asked: RunCredentialInput[] }> {
    const asked: RunCredentialInput[] = [];
    const execution = create(RunSchema, {
      metadata: { id: "aex_stamp", org: ORG },
      spec: { target: { case: "sessionId", value: "ses_rec" }, message: "hi" },
      status: { credentials: { person: "ida_ana" } },
    });
    const planner = deps({
      session: create(SessionSchema, { metadata: { id: "ses_rec", org: ORG } }),
      resolve: async () => sources({ LINEAR_API_KEY: "vlt_team" }),
      asked,
    });
    const ctx = new RequestContext(
      RunSchema,
      execution,
      testCallerIdentity({ identityId: "ida_ana" }),
      ApiResourceKind.run,
    );
    const before = await store.listResources(ApiResourceKind.run);
    await newPlanRunValuesStep(planner).execute(ctx);
    // The step writes nothing anywhere: the manifest rides the run's own
    // row, which Persist writes after it.
    expect(await store.listResources(ApiResourceKind.run)).toEqual(before);
    return { run: ctx.newState, asked };
  }

  it("plans for the stamped person and stamps the manifest on the run's status", async () => {
    const { run, asked } = await planned();
    expect(asked[0]?.execution.status?.credentials?.person).toBe("ida_ana");
    expect(run.status?.credentials?.person).toBe("ida_ana");
    expect(run.status?.credentials?.sources.map((entry) => entry.key)).toEqual([
      "LINEAR_API_KEY",
    ]);
  });

  it("keeps the person and the manifest through the runner's status writes, for recover", async () => {
    const { run } = await planned();
    // The runner's status write replaces its own fields wholesale and never
    // the server's: the person and the manifest are still there.
    applyUpdateStatusMerge(
      run,
      create(RunUpdateStatusInputSchema, {
        runId: "aex_stamp",
        status: {
          phase: RunPhase.RUN_FAILED,
          credentials: { person: "ida_forged", sources: sources({ STOLEN_KEY: "vlt_x" }) },
        },
      }),
      silentLogger,
    );
    expect(run.status?.credentials?.person).toBe("ida_ana");
    expect(run.status?.credentials?.sources.map((entry) => entry.key)).toEqual([
      "LINEAR_API_KEY",
    ]);
  });
});
