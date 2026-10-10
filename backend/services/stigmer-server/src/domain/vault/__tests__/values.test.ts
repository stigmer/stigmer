/**
 * Pins VaultValueController.fetchValues (domain/vault/values.ts) over a real
 * store, vault service and resolver, with the open-source execution-scoped
 * credential:
 *
 *   - the gate refuses with PERMISSION_DENIED, never a redacted answer: no
 *     bearer, a person's token, a credential for another execution, a run
 *     credential whose run ended past the grace, a run credential bound to
 *     a connect (a shape no mint produces), a connect whose attempt is
 *     gone or expired, and a composed decision that answers false or
 *     throws; an empty execution id is INVALID_ARGUMENT;
 *   - a run credential bound to a live run receives the run's manifest
 *     opened, grouped by declarer;
 *   - a connect attempt that names a run (the runner's backfill) receives
 *     only that tool's entries of the run's manifest, never the agent's or
 *     another tool's;
 *   - a connect attempt that names none receives a plan made now over its
 *     person's My vault, and a caller who was no person gets no My vault;
 *   - past an edition's admitting decision, the handler's own loads still
 *     refuse: an id of no execution kind, a run that is gone, a connect
 *     that is over, a backfill's run of another organization, a connect's
 *     tool that is gone; a store fault is INTERNAL without its text;
 *   - the registered service validates the request (an empty id is
 *     INVALID_ARGUMENT) and answers through the gate.
 */
import { randomBytes } from "node:crypto";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient, createRouterTransport } from "@connectrpc/connect";
import type { HandlerContext } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AgentSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { RunCredentialsSchema, RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import {
  FetchExecutionValuesInputSchema,
  VaultValueController,
} from "@stigmer/protos/ai/stigmer/agentic/vault/v1/values_pb";
import type { ExecutionValues } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/values_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { createApiResourceInterceptor } from "../../../pipeline/interceptors/apiresource.js";
import { createVerifierChainInterceptor } from "../../../pipeline/interceptors/auth.js";
import type { Store } from "../../../store/interface.js";
import { newPermissiveSingleTeamAuthorizer } from "../../../pipeline/steps/authorize.js";
import { RUN_CREDENTIAL_GRACE_AFTER_TERMINAL_MS } from "../../../runnerauth/constants.js";
import { newExecutionScopedRunnerCredentialProvider } from "../../../runnerauth/runner-credential-provider.js";
import type { RunnerCredentialProvider } from "../../../runnerauth/runner-credential-provider.js";
import { RunnerAuthService, TOKEN_TYPE_EXECUTION_SCOPED } from "../../../runnerauth/runnerauth.js";
import { newConnectExecutionId } from "../../mcpserver/connect-execution-id.js";

import { registerVaultServices } from "../controller.js";
import type { VaultControllerDeps } from "../controller.js";
import { newVaultResolver } from "../resolve.js";
import type { VaultResolver } from "../resolve.js";
import { fetchExecutionValues } from "../values.js";
import type { ExecutionValuesDeps } from "../values.js";
import type { VaultRig } from "./support.js";
import { openVaultRig, silentLogger } from "./support.js";

const ORG = "acme";
const ANA = "ida_ana";
const SESSION_ID = "ses_values";
const NOT_BOUND = "only a runner credential bound to this live execution may fetch its values";

let rig: VaultRig;
let resolver: VaultResolver;
let credentials: RunnerCredentialProvider;

beforeEach(() => {
  rig = openVaultRig();
  resolver = newVaultResolver({
    store: rig.store,
    logger: silentLogger,
    authorizer: newPermissiveSingleTeamAuthorizer(),
    secretService: rig.secrets,
    vaults: rig.vaults,
    platformClients: { findById: async () => undefined },
    freshener: { freshToken: async (_vault, connection) => connection.token },
  });
  credentials = newExecutionScopedRunnerCredentialProvider(RunnerAuthService.create(randomBytes(32)));
});

afterEach(() => {
  rig.close();
});

function deps(overrides: Partial<ExecutionValuesDeps> = {}): ExecutionValuesDeps {
  return { store: rig.store, logger: silentLogger, runnerAuth: credentials, vaultResolver: resolver, ...overrides };
}

/** The runner's call: its credential as the Bearer header. */
function bearer(token: string): HandlerContext {
  return {
    requestHeader: new Headers(token === "" ? {} : { authorization: `Bearer ${token}` }),
  } as unknown as HandlerContext;
}

function fetch(executionId: string, token: string, over: ExecutionValuesDeps = deps()): Promise<ExecutionValues> {
  return fetchExecutionValues(over, create(FetchExecutionValuesInputSchema, { executionId }), bearer(token));
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

function tool(slug: string, env: Record<string, { isSecret: boolean }>): McpServer {
  return create(McpServerSchema, {
    metadata: { id: `mcp_${slug}`, name: slug, slug, org: ORG },
    spec: {
      serverType: { case: "http", value: { url: `https://mcp.${slug}.example/mcp` } },
      env,
    },
  });
}

const LINEAR = tool("linear", { LINEAR_KEY: { isSecret: true } });
const NOTION = tool("notion", { NOTION_KEY: { isSecret: true } });

/** Ana's My vault with every key the run and its tools use. */
async function seedAnasVault(): Promise<void> {
  const ana = testCallerIdentity({ identityId: ANA });
  const mine = await rig.vaults.ensureMine(ORG, ana);
  await rig.vaults.setSecrets(
    mine.metadata!.id,
    {
      AGENT_KEY: { value: "agent-secret", description: "" },
      LINEAR_KEY: { value: "linear-secret", description: "" },
      NOTION_KEY: { value: "notion-secret", description: "" },
    },
    ana,
  );
}

/** A planned, stored run of Ana's: its agent declares AGENT_KEY and it uses Linear and Notion. */
async function seedRun(
  id: string,
  status: { phase?: RunPhase; completedAt?: string } = {},
): Promise<Run> {
  await seedAnasVault();
  for (const server of [LINEAR, NOTION]) {
    await rig.store.saveResource(ApiResourceKind.mcp_server, server.metadata!.id, McpServerSchema, server);
  }
  const session = create(SessionSchema, {
    metadata: { id: SESSION_ID, org: ORG },
    spec: { includeMyVault: true },
  });
  await rig.store.saveResource(ApiResourceKind.session, SESSION_ID, SessionSchema, session);
  const run = create(RunSchema, {
    metadata: { id, name: id, org: ORG },
    spec: { target: { case: "sessionId", value: SESSION_ID } },
    status: {
      phase: status.phase ?? RunPhase.RUN_IN_PROGRESS,
      completedAt: status.completedAt ?? "",
      credentials: { person: ANA },
    },
  });
  const sources = await resolver.planRun({
    execution: run,
    session,
    agentSpec: create(AgentSpecSchema, { env: { AGENT_KEY: { isSecret: true } } }),
    agentName: "Helper",
    agentOrg: ORG,
    tools: [LINEAR, NOTION],
  });
  run.status!.credentials = create(RunCredentialsSchema, { person: ANA, sources });
  await rig.store.saveResource(ApiResourceKind.run, id, RunSchema, run);
  return run;
}

/** Records a connect attempt as the connect lane does. */
async function seedAttempt(
  id: string,
  init: { person?: string; runId?: string; mcpServerId?: string; expiresAt?: number } = {},
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await rig.store.connectAttempts.create({
    id,
    org: ORG,
    createdBy: init.person ?? ANA,
    person: init.person ?? ANA,
    mcpServerId: init.mcpServerId ?? LINEAR.metadata!.id,
    runId: init.runId ?? "",
    createdAt: now,
    expiresAt: init.expiresAt ?? now + 600,
  });
}

function grouped(values: ExecutionValues): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {
    agent: { ...values.agent },
  };
  for (const group of values.tools) {
    out[group.mcpServerId] = { ...group.values };
  }
  return out;
}

describe("the gate", () => {
  it("answers a run credential bound to the live run with the run's values, grouped by declarer", async () => {
    await seedRun("run_live");
    const values = await fetch("run_live", credentials.mintRunCredential!("run_live"));
    expect(grouped(values)).toEqual({
      agent: { AGENT_KEY: "agent-secret" },
      mcp_linear: { LINEAR_KEY: "linear-secret" },
      mcp_notion: { NOTION_KEY: "notion-secret" },
    });
  });

  it.each([
    ["no bearer", () => ""],
    ["a person's token", () => "eyJ.person.token"],
    ["a credential for another run", () => credentials.mintRunCredential!("run_other")],
  ])("refuses %s with PermissionDenied, never a redacted answer", async (_label, tokenOf) => {
    await seedRun("run_live");
    const failure = await refusal(fetch("run_live", tokenOf()));
    expect(failure.code).toBe(Code.PermissionDenied);
    expect(failure.rawMessage).toBe(NOT_BOUND);
  });

  it("refuses a run credential whose run ended past the grace, and admits one inside it", async () => {
    const longAgo = new Date(Date.now() - RUN_CREDENTIAL_GRACE_AFTER_TERMINAL_MS - 60_000).toISOString();
    await seedRun("run_over", { phase: RunPhase.RUN_COMPLETED, completedAt: longAgo });
    const failure = await refusal(fetch("run_over", credentials.mintRunCredential!("run_over")));
    expect(failure.code).toBe(Code.PermissionDenied);

    const justNow = new Date(Date.now() - 1_000).toISOString();
    await seedRun("run_just_over", { phase: RunPhase.RUN_COMPLETED, completedAt: justNow });
    const values = await fetch("run_just_over", credentials.mintRunCredential!("run_just_over"));
    expect(grouped(values).agent).toEqual({ AGENT_KEY: "agent-secret" });
  });

  it("refuses a run credential bound to a connect: no mint produces that shape", async () => {
    await seedAnasVault();
    await rig.store.saveResource(ApiResourceKind.mcp_server, LINEAR.metadata!.id, McpServerSchema, LINEAR);
    const connectId = newConnectExecutionId(LINEAR.metadata!.id);
    await seedAttempt(connectId);
    const failure = await refusal(fetch(connectId, credentials.mintRunCredential!(connectId)));
    expect(failure.code).toBe(Code.PermissionDenied);
  });

  it("refuses a connect whose attempt is expired or gone", async () => {
    const expired = newConnectExecutionId(LINEAR.metadata!.id);
    await seedAttempt(expired, { expiresAt: Math.floor(Date.now() / 1000) - 1 });
    expect((await refusal(fetch(expired, credentials.mint(TOKEN_TYPE_EXECUTION_SCOPED, expired, 300).token))).code).toBe(
      Code.PermissionDenied,
    );
    const gone = newConnectExecutionId(LINEAR.metadata!.id);
    expect((await refusal(fetch(gone, credentials.mint(TOKEN_TYPE_EXECUTION_SCOPED, gone, 300).token))).code).toBe(
      Code.PermissionDenied,
    );
  });

  it("lets a composed decision own the gate: false refuses, a throw refuses, true admits", async () => {
    await seedRun("run_live");
    const composed = (answer: () => Promise<boolean>): ExecutionValuesDeps =>
      deps({ runnerAuth: { ...credentials, authorizeExecutionValuesRead: answer } });
    expect((await refusal(fetch("run_live", "edition-token", composed(async () => false)))).code).toBe(
      Code.PermissionDenied,
    );
    expect(
      (
        await refusal(
          fetch(
            "run_live",
            "edition-token",
            composed(async () => {
              throw new Error("policy fault");
            }),
          ),
        )
      ).code,
    ).toBe(Code.PermissionDenied);
    const admitted = await fetch("run_live", "edition-token", composed(async () => true));
    expect(grouped(admitted).agent).toEqual({ AGENT_KEY: "agent-secret" });
  });

  it("still requires a live run after a composed decision admits: an ended run's values are refused", async () => {
    const longAgo = new Date(Date.now() - RUN_CREDENTIAL_GRACE_AFTER_TERMINAL_MS - 60_000).toISOString();
    await seedRun("run_over", { phase: RunPhase.RUN_COMPLETED, completedAt: longAgo });
    const admitting = deps({ runnerAuth: { ...credentials, authorizeExecutionValuesRead: async () => true } });
    const failure = await refusal(fetch("run_over", "edition-token", admitting));
    expect(failure.code).toBe(Code.PermissionDenied);
    expect(failure.rawMessage).toBe(NOT_BOUND);
  });

  it("refuses an empty execution id as an invalid argument", async () => {
    const failure = await refusal(fetch("", "anything"));
    expect(failure.code).toBe(Code.InvalidArgument);
  });
});

describe("a connect's values", () => {
  it("the backfill of a run's tool receives only that tool's planned entries", async () => {
    await seedRun("run_backfill");
    const connectId = newConnectExecutionId(LINEAR.metadata!.id);
    await seedAttempt(connectId, { runId: "run_backfill" });
    const values = await fetch(connectId, credentials.mint(TOKEN_TYPE_EXECUTION_SCOPED, connectId, 300).token);
    expect(grouped(values)).toEqual({ agent: {}, mcp_linear: { LINEAR_KEY: "linear-secret" } });
  });

  it("a person's connect is planned now over their own My vault", async () => {
    await seedAnasVault();
    await rig.store.saveResource(ApiResourceKind.mcp_server, NOTION.metadata!.id, McpServerSchema, NOTION);
    const connectId = newConnectExecutionId(NOTION.metadata!.id);
    await seedAttempt(connectId, { mcpServerId: NOTION.metadata!.id });
    const values = await fetch(connectId, credentials.mint(TOKEN_TYPE_EXECUTION_SCOPED, connectId, 300).token);
    expect(grouped(values)).toEqual({ agent: {}, mcp_notion: { NOTION_KEY: "notion-secret" } });
  });

  it("a connect started by no person reads no My vault: a required key is refused, naming it", async () => {
    await seedAnasVault();
    await rig.store.saveResource(ApiResourceKind.mcp_server, NOTION.metadata!.id, McpServerSchema, NOTION);
    const connectId = newConnectExecutionId(NOTION.metadata!.id);
    await seedAttempt(connectId, { mcpServerId: NOTION.metadata!.id, person: "" });
    const failure = await refusal(fetch(connectId, credentials.mint(TOKEN_TYPE_EXECUTION_SCOPED, connectId, 300).token));
    expect(failure.code).toBe(Code.FailedPrecondition);
    expect(failure.rawMessage).toContain("notion needs NOTION_KEY");
  });
});

describe("past a composed decision that admits", () => {
  /** An edition's decision that admits every bearer: what remains is the handler's own load. */
  const admitting = (over: Partial<ExecutionValuesDeps> = {}): ExecutionValuesDeps =>
    deps({ runnerAuth: { ...credentials, authorizeExecutionValuesRead: async () => true }, ...over });

  /** The store, with reads of `kind` failing as `fault`. */
  function faultingStore(kind: ApiResourceKind, fault: Error): Store {
    return new Proxy(rig.store, {
      get(target, prop, receiver) {
        if (prop === "getResource") {
          return (...args: Parameters<typeof rig.store.getResource>) =>
            args[0] === kind ? Promise.reject(fault) : rig.store.getResource(...args);
        }
        const value = Reflect.get(target, prop, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }

  it("refuses an id that names no execution kind", async () => {
    expect((await refusal(fetch("ses_1", "edition-token", admitting()))).code).toBe(Code.PermissionDenied);
  });

  it("refuses a run that does not exist, and answers a store fault as INTERNAL without its text", async () => {
    expect((await refusal(fetch("run_ghost", "edition-token", admitting()))).code).toBe(Code.PermissionDenied);
    const faulted = await refusal(
      fetch("run_ghost", "edition-token", admitting({ store: faultingStore(ApiResourceKind.run, new Error("disk gone")) })),
    );
    expect(faulted.code).toBe(Code.Internal);
    expect(faulted.rawMessage).not.toContain("disk gone");
  });

  it("refuses a connect whose attempt is over at the gate, and one that ends between the gate and the read", async () => {
    const atTheGate = await refusal(fetch(newConnectExecutionId("mcp_linear"), "edition-token", admitting()));
    expect(atTheGate.code).toBe(Code.PermissionDenied);

    // The attempt is live when the gate reads it and gone when the values
    // are read (its connect settled in between).
    const connectId = newConnectExecutionId(LINEAR.metadata!.id);
    await seedAttempt(connectId);
    let reads = 0;
    const settling = new Proxy(rig.store, {
      get(target, prop, receiver) {
        if (prop === "connectAttempts") {
          const attempts = target.connectAttempts;
          return {
            ...attempts,
            findLive: async (id: string, now: number) => {
              reads += 1;
              return reads === 1 ? attempts.findLive(id, now) : undefined;
            },
          };
        }
        const value = Reflect.get(target, prop, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const raced = await refusal(fetch(connectId, "edition-token", admitting({ store: settling })));
    expect(raced.code).toBe(Code.FailedPrecondition);
    expect(raced.rawMessage).toBe("this connect is over: connect the tool again");
  });

  it("refuses a backfill whose run belongs to another organization than its attempt", async () => {
    await seedRun("run_elsewhere");
    const connectId = newConnectExecutionId(LINEAR.metadata!.id);
    await rig.store.connectAttempts.create({
      id: connectId,
      org: "another-org",
      createdBy: ANA,
      person: ANA,
      mcpServerId: LINEAR.metadata!.id,
      runId: "run_elsewhere",
      createdAt: 0,
      expiresAt: Math.floor(Date.now() / 1000) + 600,
    });
    expect((await refusal(fetch(connectId, "edition-token", admitting()))).code).toBe(Code.PermissionDenied);
  });

  it("refuses a connect whose tool is gone, and answers a store fault as INTERNAL", async () => {
    const connectId = newConnectExecutionId("mcp_gone");
    await seedAttempt(connectId, { mcpServerId: "mcp_gone" });
    const gone = await refusal(fetch(connectId, "edition-token", admitting()));
    expect(gone.code).toBe(Code.FailedPrecondition);
    expect(gone.rawMessage).toContain("MCP server mcp_gone no longer exists");
    const faulted = await refusal(
      fetch(
        connectId,
        "edition-token",
        admitting({ store: faultingStore(ApiResourceKind.mcp_server, new Error("disk gone")) }),
      ),
    );
    expect(faulted.code).toBe(Code.Internal);
  });
});

describe("the open-source gate's own faults", () => {
  it("answers a store fault reading the bound execution as INTERNAL, never as a refusal", async () => {
    const faulting = new Proxy(rig.store, {
      get(target, prop, receiver) {
        if (prop === "getResource") {
          return () => Promise.reject(new Error("disk gone"));
        }
        const value = Reflect.get(target, prop, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const failure = await refusal(
      fetch("run_live", credentials.mintRunCredential!("run_live"), deps({ store: faulting })),
    );
    expect(failure.code).toBe(Code.Internal);
    expect(failure.rawMessage).not.toContain("disk gone");
  });
});

describe("the registered service", () => {
  it("validates the request and answers through the gate", async () => {
    await seedRun("run_live");
    const unused = new Proxy({} as VaultControllerDeps["signIn"], {
      get(_target, prop) {
        throw new Error(`signIn.${String(prop)} reached by a values fetch`);
      },
    });
    const transport = createRouterTransport(
      (router) => {
        registerVaultServices(router, {
          store: rig.store,
          logger: silentLogger,
          authorizer: newPermissiveSingleTeamAuthorizer(),
          authorizationLifecycle: undefined,
          secretService: rig.secrets,
          listReadScope: undefined,
          vaults: rig.vaults,
          signIn: unused,
          values: deps(),
        });
      },
      {
        router: {
          interceptors: [createVerifierChainInterceptor([], [], silentLogger), createApiResourceInterceptor()],
        },
      },
    );
    const client = createClient(VaultValueController, transport);
    const values = await client.fetchValues(
      { executionId: "run_live" },
      { headers: { authorization: `Bearer ${credentials.mintRunCredential!("run_live")}` } },
    );
    expect(Object.keys(values.agent)).toEqual(["AGENT_KEY"]);
    const invalid = await refusal(client.fetchValues({ executionId: "" }));
    expect(invalid.code).toBe(Code.InvalidArgument);
  });
});
