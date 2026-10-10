/**
 * Pins listTools, the lane that lists one plugin server's tools as the
 * caller through a runner and stores nothing: the input and lookup
 * refusals (InvalidArgument, NotFound for the plugin and for a server it
 * does not carry, FailedPrecondition without an engine); a server whose
 * required key the caller's My vault lacks is refused FAILED_PRECONDITION
 * naming the key before any attempt is recorded or any run starts (the
 * real resolver over a person with no My vault); a listing records its
 * connect attempt (plugin id, server, person) before the run starts and
 * ends it when the run settles, whatever the outcome; the runner
 * credential is minted for the attempt only when the server reads values;
 * the run goes to the shared runner queue, or to a connect sandbox that is
 * released afterwards; the tools come back with `destructive` only for an
 * explicit hint; and each failure class maps to its code and copy
 * (application to FailedPrecondition with transport-aware words or the
 * runner's own OAuth sentence, timeout to DeadlineExceeded, a lost run to
 * Unavailable, anything else to Internal, a failed start to Internal).
 *
 * The store is a fake that answers only the plugin read and the attempt
 * table and throws on any other member, so "stores nothing" is structural;
 * the engine is a fake recording each start.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { beforeEach, describe, expect, it } from "vitest";

import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import {
  HttpMcpServerSchema,
  McpServerEntrySchema,
  PluginStatusSchema,
  StdioMcpServerSchema,
} from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import { EnvVarDeclarationSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/declaration_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { ListPluginToolsInputSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/io_pb";

import { createLogger } from "../../../boot/logger.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import { untouchable } from "../../../pipeline/__tests__/support.js";
import { newPermissiveSingleTeamAuthorizer } from "../../../pipeline/steps/authorize.js";
import type { RunnerCredentialProvider } from "../../../runnerauth/runner-credential-provider.js";
import type { SandboxLane } from "../../../sandbox/lane.js";
import type { SandboxProvisioner } from "../../../sandbox/provisioner.js";
import type { ConnectAttemptRecord, Store } from "../../../store/interface.js";
import { ResourceNotFoundError } from "../../../store/interface.js";
import { newVaultResolver } from "../../vault/resolve.js";
import type { VaultResolver, VaultResolverDeps } from "../../vault/resolve.js";
import { LIST_TOOLS_TIMEOUT, listTools } from "../list-tools.js";
import type { PluginToolsDeps } from "../list-tools.js";
import type {
  PluginToolsEngine,
  ToolsRun,
  ToolsRunOutcome,
  ToolsTaskQueue,
  ToolsWorkflowInput,
} from "../tools/engine.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const ORG = "org_acme";
const PLUGIN_ID = "plg_tools";
const PERSON = "acc_person";

const caller: CallerIdentity = {
  identityId: PERSON,
  callerClass: "user",
  issuer: "",
  rawToken: "",
};

/** A plugin with a keyed server, an open server and a local program. */
function storedPlugin(): Plugin {
  return create(PluginSchema, {
    metadata: create(ApiResourceMetadataSchema, {
      id: PLUGIN_ID,
      org: ORG,
      name: "acme",
      slug: "acme",
    }),
    status: create(PluginStatusSchema, {
      mcpServers: [
        create(McpServerEntrySchema, {
          name: "github",
          env: ["GITHUB_TOKEN"],
          transport: {
            case: "http",
            value: create(HttpMcpServerSchema, {
              url: "https://api.example.test/mcp",
              headers: { Authorization: "Bearer ${GITHUB_TOKEN}" },
            }),
          },
        }),
        create(McpServerEntrySchema, {
          name: "docs",
          transport: {
            case: "http",
            value: create(HttpMcpServerSchema, {
              url: "https://docs.example.test/mcp",
            }),
          },
        }),
        create(McpServerEntrySchema, {
          name: "db",
          transport: {
            case: "stdio",
            value: create(StdioMcpServerSchema, {
              command: "npx",
              args: ["-y", "db-mcp"],
            }),
          },
        }),
      ],
      env: {
        GITHUB_TOKEN: create(EnvVarDeclarationSchema, {
          isSecret: true,
          optional: false,
        }),
      },
    }),
  });
}

/** The attempt table, observable: every create and delete in order. */
class AttemptTable {
  readonly rows = new Map<string, ConnectAttemptRecord>();
  readonly events: string[] = [];
  create(attempt: ConnectAttemptRecord): Promise<void> {
    this.events.push(`create:${attempt.id}`);
    this.rows.set(attempt.id, attempt);
    return Promise.resolve();
  }
  findLive(id: string): Promise<ConnectAttemptRecord | undefined> {
    return Promise.resolve(this.rows.get(id));
  }
  delete(id: string): Promise<void> {
    this.events.push(`delete:${id}`);
    this.rows.delete(id);
    return Promise.resolve();
  }
  deleteExpired(): Promise<number> {
    return Promise.resolve(0);
  }
  deleteByOrg(): Promise<number> {
    return Promise.resolve(0);
  }
}

/** A store answering the plugin read and the attempt table only; any other member throws. */
function fakeStore(
  attempts: AttemptTable,
  plugin: Plugin | null = storedPlugin(),
): Store {
  const answers: Partial<Store> = {
    getResource: (() =>
      plugin === null
        ? Promise.reject(new ResourceNotFoundError(`plugin/${PLUGIN_ID}`))
        : Promise.resolve(plugin)) as Store["getResource"],
    connectAttempts: attempts,
  };
  return new Proxy(answers as Store, {
    get(target, prop) {
      if (prop in target) {
        return target[prop as keyof Store];
      }
      throw new Error(`store.${String(prop)} reached by a listing`);
    },
  });
}

interface Start {
  readonly attemptId: string;
  readonly input: ToolsWorkflowInput;
  readonly runTimeoutMs: number;
  readonly taskQueue: ToolsTaskQueue;
  /** Whether the attempt row existed when the run started. */
  readonly attemptLive: boolean;
}

/** An engine whose every run settles with `outcome`; records each start. */
function fakeEngine(
  attempts: AttemptTable,
  outcome: ToolsRunOutcome | Error,
): { engine: PluginToolsEngine; starts: Start[] } {
  const starts: Start[] = [];
  return {
    starts,
    engine: {
      startListing(
        attemptId,
        input,
        runTimeoutMs,
        taskQueue,
      ): Promise<ToolsRun> {
        starts.push({
          attemptId,
          input,
          runTimeoutMs,
          taskQueue,
          attemptLive: attempts.rows.has(attemptId),
        });
        if (outcome instanceof Error) {
          return Promise.reject(outcome);
        }
        return Promise.resolve({
          workflowId: `wf-${attemptId}`,
          result: () => Promise.resolve(outcome),
        });
      },
    },
  };
}

/** A resolver that plans every listing; the missing-key case uses the real one. */
const planningResolver: VaultResolver = {
  planRun: () => Promise.resolve([]),
  openRun: () => Promise.reject(new Error("not used")),
  planConnect: () => Promise.resolve([]),
  openConnect: () => Promise.reject(new Error("not used")),
};

function runnerAuth(
  enabled: boolean,
): RunnerCredentialProvider & { readonly minted: string[] } {
  const minted: string[] = [];
  return {
    minted,
    isEnabled: () => enabled,
    mint: (_lane, binding) => {
      minted.push(binding);
      return { token: `token-for-${binding}`, ttlSeconds: 60 };
    },
    verify: () => {
      throw new Error("not used");
    },
  };
}

function deps(
  overrides: Partial<PluginToolsDeps> & { readonly attempts: AttemptTable },
): PluginToolsDeps {
  const { attempts, ...rest } = overrides;
  return {
    store: fakeStore(attempts),
    logger: silentLogger,
    authorizer: newPermissiveSingleTeamAuthorizer(),
    engineState: () => ({ connected: false }),
    runnerAuth: runnerAuth(true),
    vaultResolver: planningResolver,
    sandboxLane: { enabled: false },
    ...rest,
  };
}

function input(
  server: string,
  overrides: { pluginId?: string; org?: string } = {},
) {
  return create(ListPluginToolsInputSchema, {
    pluginId: overrides.pluginId ?? PLUGIN_ID,
    server,
    org: overrides.org ?? ORG,
  });
}

async function refusal(promise: Promise<unknown>): Promise<ConnectError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ConnectError);
    return error as ConnectError;
  }
  throw new Error("expected a refusal, the listing succeeded");
}

let attempts: AttemptTable;
beforeEach(() => {
  attempts = new AttemptTable();
});

describe("listTools — refusals before anything starts", () => {
  it("refuses a missing plugin id, server or organization", async () => {
    for (const bad of [
      input("github", { pluginId: "" }),
      input(""),
      input("github", { org: "" }),
    ]) {
      const error = await refusal(listTools(deps({ attempts }), bad, caller));
      expect(error.code).toBe(Code.InvalidArgument);
    }
  });

  it("answers NotFound for a plugin that does not exist and for a server it does not carry", async () => {
    const missing = await refusal(
      listTools(
        deps({ attempts, store: fakeStore(attempts, null) }),
        input("github"),
        caller,
      ),
    );
    expect(missing.code).toBe(Code.NotFound);
    expect(missing.rawMessage).toBe(`plugin not found: ${PLUGIN_ID}`);

    const noServer = await refusal(
      listTools(deps({ attempts }), input("nope"), caller),
    );
    expect(noServer.code).toBe(Code.NotFound);
    expect(noServer.rawMessage).toContain("MCP server of plugin 'acme'");
  });

  it("answers FailedPrecondition when no engine is connected", async () => {
    const error = await refusal(
      listTools(deps({ attempts }), input("docs"), caller),
    );
    expect(error.code).toBe(Code.FailedPrecondition);
    expect(error.rawMessage).toContain("Temporal not configured");
    expect(attempts.events).toEqual([]);
  });

  it("refuses FAILED_PRECONDITION naming a required key the caller's My vault lacks, before any attempt or run", async () => {
    const { engine, starts } = fakeEngine(attempts, {
      ok: true,
      output: { tools: [] },
    });
    const resolverDeps: VaultResolverDeps = {
      store: fakeStore(attempts),
      logger: silentLogger,
      authorizer: newPermissiveSingleTeamAuthorizer(),
      secretService: untouchable("secretService"),
      vaults: {
        ...untouchable<VaultResolverDeps["vaults"]>("vaults"),
        findMine: () => Promise.resolve(undefined),
      },
      platformClients: untouchable("platformClients"),
      freshener: untouchable("freshener"),
    };
    const error = await refusal(
      listTools(
        deps({
          attempts,
          engineState: () => ({ connected: true, engine }),
          vaultResolver: newVaultResolver(resolverDeps),
        }),
        input("github"),
        caller,
      ),
    );
    expect(error.code).toBe(Code.FailedPrecondition);
    expect(error.rawMessage).toContain("needs GITHUB_TOKEN");
    expect(error.rawMessage).toContain("to My vault");
    expect(starts).toEqual([]);
    expect(attempts.events).toEqual([]);
  });
});

describe("listTools — a listing", () => {
  it("records the attempt before the run, mints the credential for a server that reads values, and ends the attempt", async () => {
    const auth = runnerAuth(true);
    const { engine, starts } = fakeEngine(attempts, {
      ok: true,
      output: {
        tools: [
          { name: "search", description: "Searches", destructiveHint: false },
          {
            name: "delete_repo",
            description: "Deletes",
            destructiveHint: true,
          },
          {},
        ],
      },
    });
    const listed = await listTools(
      deps({
        attempts,
        runnerAuth: auth,
        engineState: () => ({ connected: true, engine }),
      }),
      input("github"),
      caller,
    );

    expect(
      listed.tools.map((t) => [t.name, t.description, t.destructive]),
    ).toEqual([
      ["search", "Searches", false],
      ["delete_repo", "Deletes", true],
      ["", "", false],
    ]);
    expect(starts).toHaveLength(1);
    const start = starts[0]!;
    expect(start.attemptId).toMatch(
      new RegExp(`^connect-${PLUGIN_ID}-[0-9a-f]{8}$`),
    );
    expect(start.attemptLive).toBe(true);
    expect(start.runTimeoutMs).toBe(LIST_TOOLS_TIMEOUT.ms);
    expect(start.taskQueue).toEqual({ kind: "runner" });
    expect(start.input).toEqual({
      plugin_id: PLUGIN_ID,
      server: "github",
      execution_context_id: start.attemptId,
      execution_context_token: `token-for-${start.attemptId}`,
    });
    expect(auth.minted).toEqual([start.attemptId]);
    expect(attempts.events).toEqual([
      `create:${start.attemptId}`,
      `delete:${start.attemptId}`,
    ]);
    expect(attempts.rows.size).toBe(0);
  });

  it("records who asked and for which server", async () => {
    let recorded: ConnectAttemptRecord | undefined;
    const table = new AttemptTable();
    const original = table.create.bind(table);
    table.create = (attempt) => {
      recorded = attempt;
      return original(attempt);
    };
    const { engine } = fakeEngine(table, { ok: true, output: {} });
    await listTools(
      deps({
        attempts: table,
        engineState: () => ({ connected: true, engine }),
      }),
      input("docs"),
      caller,
    );
    expect(recorded).toMatchObject({
      org: ORG,
      createdBy: PERSON,
      person: PERSON,
      pluginId: PLUGIN_ID,
      server: "docs",
    });
    expect(recorded!.expiresAt).toBeGreaterThan(recorded!.createdAt);
  });

  it("sends a server that reads nothing with ids only, and mints nothing", async () => {
    const auth = runnerAuth(true);
    const { engine, starts } = fakeEngine(attempts, { ok: true, output: {} });
    const listed = await listTools(
      deps({
        attempts,
        runnerAuth: auth,
        engineState: () => ({ connected: true, engine }),
      }),
      input("docs"),
      caller,
    );
    expect(listed.tools).toEqual([]);
    expect(starts[0]?.input).toEqual({ plugin_id: PLUGIN_ID, server: "docs" });
    expect(auth.minted).toEqual([]);
  });

  it("degrades to the attempt alone when the credential lane cannot mint", async () => {
    const { engine, starts } = fakeEngine(attempts, { ok: true, output: {} });
    await listTools(
      deps({
        attempts,
        runnerAuth: runnerAuth(false),
        engineState: () => ({ connected: true, engine }),
      }),
      input("github"),
      caller,
    );
    expect(starts[0]?.input).toEqual({
      plugin_id: PLUGIN_ID,
      server: "github",
      execution_context_id: starts[0]?.attemptId,
    });
  });

  it("runs in a connect sandbox when the lane is enabled, and releases it after", async () => {
    const created: string[] = [];
    const released: string[] = [];
    const provisioner = {
      createConnectSandbox: (id: string) => {
        created.push(id);
        return Promise.resolve(`sbx-${id}`);
      },
      deprovisionConnectSandbox: (sandboxId: string) => {
        released.push(sandboxId);
        return Promise.resolve();
      },
    } as unknown as SandboxProvisioner;
    const lane: SandboxLane = {
      enabled: true,
      provisioner,
      credentials: runnerAuth(false),
    };
    const { engine, starts } = fakeEngine(attempts, {
      ok: false,
      failure: { kind: "timeout" },
    });
    await refusal(
      listTools(
        deps({
          attempts,
          sandboxLane: lane,
          engineState: () => ({ connected: true, engine }),
        }),
        input("docs"),
        caller,
      ),
    );
    const id = starts[0]!.attemptId;
    expect(created).toEqual([id]);
    expect(starts[0]?.taskQueue.kind).toBe("sandbox");
    expect(released).toEqual([`sbx-${id}`]);
    expect(attempts.rows.size).toBe(0);
  });
});

describe("listTools — failure mapping", () => {
  async function failure(
    server: string,
    outcome: ToolsRunOutcome | Error,
  ): Promise<ConnectError> {
    const { engine } = fakeEngine(attempts, outcome);
    const error = await refusal(
      listTools(
        deps({ attempts, engineState: () => ({ connected: true, engine }) }),
        input(server),
        caller,
      ),
    );
    // Every settled listing ends its attempt.
    expect(attempts.rows.size).toBe(0);
    expect(attempts.events.filter((e) => e.startsWith("delete:"))).toHaveLength(
      1,
    );
    return error;
  }

  it("maps the runner's message to FailedPrecondition in words for a server at an address", async () => {
    const error = await failure("docs", {
      ok: false,
      failure: { kind: "application", message: "connection refused" },
    });
    expect(error.code).toBe(Code.FailedPrecondition);
    expect(error.rawMessage).toBe(
      "listing the tools of plugin:acme:docs failed: connection refused. Check that the server's address is reachable and your sign-in or key is valid",
    );
  });

  it("maps the runner's message to FailedPrecondition in words for a local program", async () => {
    const error = await failure("db", {
      ok: false,
      failure: { kind: "application", message: "spawn npx ENOENT" },
    });
    expect(error.code).toBe(Code.FailedPrecondition);
    expect(error.rawMessage).toContain(
      "It is a local program the runner starts",
    );
  });

  it("passes the runner's OAuth sentence through as it is", async () => {
    const sentence = "plugin:acme:docs requires OAuth: sign in to it first";
    const error = await failure("docs", {
      ok: false,
      failure: { kind: "application", message: sentence },
    });
    expect(error.code).toBe(Code.FailedPrecondition);
    expect(error.rawMessage).toBe(sentence);
  });

  it("maps the budget to DeadlineExceeded, a lost run to Unavailable and anything else to Internal", async () => {
    const timeout = await failure("docs", {
      ok: false,
      failure: { kind: "timeout" },
    });
    expect(timeout.code).toBe(Code.DeadlineExceeded);
    expect(timeout.rawMessage).toContain(
      `within the ${LIST_TOOLS_TIMEOUT.label} budget`,
    );

    attempts = new AttemptTable();
    const lost = await failure("docs", {
      ok: false,
      failure: { kind: "service-not-found" },
    });
    expect(lost.code).toBe(Code.Unavailable);

    attempts = new AttemptTable();
    const other = await failure("docs", {
      ok: false,
      failure: { kind: "other", message: "bad config" },
    });
    expect(other.code).toBe(Code.Internal);
    expect(other.rawMessage).toContain("failed: bad config");
  });

  it("maps a run that could not start to Internal", async () => {
    const error = await failure("docs", new Error("namespace not found"));
    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe("failed to start the tools listing");
  });
});
