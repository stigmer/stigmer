/**
 * Whose personal environment a run reads (create-execution-context-step.ts,
 * the fill-ins; run-person.ts, the person). Two people in one organization
 * each save their own personal environment; the run of one must read that
 * person's values and never the other's, whichever row the organization's
 * list happens to answer first. A run that nobody started at a keyboard (a
 * schedule fire, in every edition) reads no one's, and a run whose creator
 * holds no personal environment (a lane account: a visitor, a channel, a
 * cloud schedule) reads none either. The person is read from the persisted
 * execution, so a recover rebuilds the same answer.
 *
 * Over a real store (the rows the lookup scans) with a reader that answers
 * the secret reads by environment id and records them, so a read of the
 * wrong person's row is visible even where its value would not be.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentInstanceSchema } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { Environment } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import { EnvironmentSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import { EnvironmentValueSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import type { ExecutionContext } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/api_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import type { Store } from "../../../store/interface.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import {
  PERSONAL_LABEL_KEY,
  PERSONAL_LABEL_VALUE,
} from "../../environment/constants.js";
import type { ManagedEnvironmentService } from "../../mcpserver/oauth/managed-env.js";

import type { ExecutionContextBuilderDeps } from "../create-execution-context-step.js";
import { buildAndPersistExecutionContext } from "../create-execution-context-step.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const ORG = "acme";
const ANA = "acc_ana";
const BEN = "acc_ben";

let dir: string;
let store: Store;

function seconds(at: number): Timestamp {
  return {
    $typeName: "google.protobuf.Timestamp",
    seconds: BigInt(at),
    nanos: 0,
  };
}

/** A personal environment of `creator`, saved at `createdAt` seconds. */
function personalEnvironment(
  id: string,
  creator: string,
  createdAt: number,
  data: Record<string, string>,
): Environment {
  return create(EnvironmentSchema, {
    metadata: {
      id,
      org: ORG,
      slug: id,
      labels: { [PERSONAL_LABEL_KEY]: PERSONAL_LABEL_VALUE },
    },
    spec: {
      data: Object.fromEntries(
        Object.entries(data).map(([key, value]) => [
          key,
          { value, isSecret: true },
        ]),
      ),
    },
    status: {
      audit: {
        specAudit: {
          createdBy: { id: creator },
          createdAt: seconds(createdAt),
        },
      },
    },
  });
}

// Ana saved hers AFTER Ben, so a list sorted newest-first answers hers
// first: the order the organization-wide lookup took `items[0]` from.
const BENS = personalEnvironment("env_ben", BEN, 1_000, {
  GITHUB_TOKEN: "ghp-ben",
  NOTES_TOKEN: "nt-ben",
});
const ANAS = personalEnvironment("env_ana", ANA, 2_000, {
  GITHUB_TOKEN: "ghp-ana",
  NOTES_TOKEN: "nt-ana",
});
// Carol saved one too, holding her notes token and no GitHub token.
const CAROLS = personalEnvironment("env_carol", "acc_carol", 1_500, {
  NOTES_TOKEN: "nt-carol",
});
const ENVIRONMENTS = [ANAS, BENS, CAROLS];

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "aexec-personal-reach-"));
  store = SqliteStore.open(path.join(dir, "stigmer.db"));
  for (const env of ENVIRONMENTS) {
    await store.saveResource(
      ApiResourceKind.environment,
      env.metadata!.id,
      EnvironmentSchema,
      env,
    );
  }
  await store.saveResource(
    ApiResourceKind.mcp_server,
    "mcps_notes",
    McpServerSchema,
    create(McpServerSchema, {
      metadata: { id: "mcps_notes", org: ORG, slug: "notes" },
      spec: { env: { NOTES_TOKEN: { isSecret: true } } },
    }),
  );
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** The rows a secret read touched, by environment id. */
interface Reads {
  readonly environments: string[];
}

/**
 * Builder deps for a run on an agent that declares nothing, in a session
 * that names a git repository and adds the notes server. The reader
 * answers secret reads by environment id and records which row each read
 * touched.
 */
function depsFor(
  reads: Reads,
  createdEcs: ExecutionContext[],
  storeFor: Store,
): ExecutionContextBuilderDeps {
  return {
    store: storeFor,
    logger: silentLogger,
    agentLoader: () => ({
      get: async () =>
        create(AgentSchema, { metadata: { id: "agt_reach", org: ORG } }),
    }),
    agentInstanceLoader: () => ({
      get: async (instanceId) =>
        create(AgentInstanceSchema, {
          metadata: { id: instanceId, org: ORG },
          spec: { agentId: "agt_reach" },
        }),
    }),
    sessionLoader: () => ({
      get: async (sessionId) =>
        create(SessionSchema, {
          metadata: { id: sessionId, org: ORG },
          spec: {
            agentInstanceId: "agi_reach",
            workspaceEntries: [
              {
                name: "repo",
                source: {
                  source: {
                    case: "gitRepo",
                    value: { url: "https://github.com/acme/app.git" },
                  },
                },
              },
            ],
            mcpServerUsages: [{ mcpServerRef: { slug: "notes", org: ORG } }],
          },
        }),
    }),
    environmentReader: () => ({
      getSecretValue: async (input) => {
        const id = input.environmentId ?? "";
        reads.environments.push(id);
        const env = ENVIRONMENTS.find((e) => e.metadata?.id === id);
        return create(EnvironmentValueSchema, {
          value: env?.spec?.data[input.key ?? ""]?.value ?? "",
          isSecret: true,
        });
      },
    }),
    environmentResolution: {
      resolveByReference: async () => {
        throw new Error("no environment refs on this instance");
      },
    } as unknown as ExecutionContextBuilderDeps["environmentResolution"],
    executionContextCreator: () => ({
      create: async (ec) => {
        createdEcs.push(ec);
        return ec;
      },
    }),
    executionContextDeleter: () => ({
      delete: () => Promise.reject(new Error("unused on the create path")),
    }),
    managedEnvService: {
      readSecretValue: async () => "",
      updateSecrets: async () => {},
    } as unknown as ManagedEnvironmentService,
    platformClients: {
      findById: async () => {
        throw new Error("no minting client: the client must not be read");
      },
    },
  };
}

function executionBy(
  id: string,
  creator: string,
  labels: Record<string, string> = {},
): AgentExecution {
  return create(AgentExecutionSchema, {
    metadata: { id, org: ORG, labels },
    spec: { sessionId: `ses_${id}`, message: "hi" },
    status: { audit: { specAudit: { createdBy: { id: creator } } } },
  });
}

async function build(
  execution: AgentExecution,
  storeFor: Store = store,
): Promise<{
  readonly data: NonNullable<ExecutionContext["spec"]>["data"];
  readonly reads: Reads;
}> {
  const reads: Reads = { environments: [] };
  const createdEcs: ExecutionContext[] = [];
  await buildAndPersistExecutionContext(
    depsFor(reads, createdEcs, storeFor),
    execution,
    "",
  );
  expect(createdEcs).toHaveLength(1);
  return { data: createdEcs[0]?.spec?.data ?? {}, reads };
}

describe("whose personal environment a run reads", () => {
  it("a member's run reads that member's own values, never a teammate's saved later", async () => {
    const { data, reads } = await build(executionBy("aexec_ben", BEN));
    expect(data["GITHUB_TOKEN"]?.value).toBe("ghp-ben");
    expect(data["NOTES_TOKEN"]?.value).toBe("nt-ben");
    expect(new Set(reads.environments)).toEqual(new Set(["env_ben"]));
  });

  it("each member's run reads their own: the other member's run reads hers", async () => {
    const { data, reads } = await build(executionBy("aexec_ana", ANA));
    expect(data["GITHUB_TOKEN"]?.value).toBe("ghp-ana");
    expect(data["NOTES_TOKEN"]?.value).toBe("nt-ana");
    expect(new Set(reads.environments)).toEqual(new Set(["env_ana"]));
  });

  it("a schedule fire's run reads no one's, even when it is stamped with its creator", async () => {
    // Open source's fire acts as the schedule's creator; the label is what
    // makes it a fire. The schedule row is absent, which the schedule layer
    // already degrades to no schedule environments.
    const { data, reads } = await build(
      executionBy("aexec_fire", ANA, { "stigmer.ai/schedule-id": "sch_gone" }),
    );
    expect(data["GITHUB_TOKEN"]).toBeUndefined();
    expect(data["NOTES_TOKEN"]).toBeUndefined();
    expect(reads.environments).toEqual([]);
  });

  it("a run whose creator holds no personal environment reads none (a visitor's, a channel's)", async () => {
    const { data, reads } = await build(
      executionBy("aexec_lane", "acc_guest_lane"),
    );
    expect(data["GITHUB_TOKEN"]).toBeUndefined();
    expect(data["NOTES_TOKEN"]).toBeUndefined();
    expect(reads.environments).toEqual([]);
  });

  it("a person whose personal environment lacks a key gets only what it holds", async () => {
    const { data, reads } = await build(
      executionBy("aexec_carol", "acc_carol"),
    );
    expect(data["GITHUB_TOKEN"]).toBeUndefined();
    expect(data["NOTES_TOKEN"]?.value).toBe("nt-carol");
    expect(reads.environments).toEqual(["env_carol"]);
  });

  it("a store fault scanning personal environments leaves the run without them, never failing it", async () => {
    // Only the environment scan fails; the session's server still loads.
    const failingScan = new Proxy(store, {
      get(target, property, receiver) {
        if (property === "listResources") {
          return async (kind: ApiResourceKind) => {
            if (kind === ApiResourceKind.environment) {
              throw new Error("store offline");
            }
            return target.listResources(kind);
          };
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    const { data, reads } = await build(
      executionBy("aexec_fault", BEN),
      failingScan,
    );
    expect(data["GITHUB_TOKEN"]).toBeUndefined();
    expect(data["NOTES_TOKEN"]).toBeUndefined();
    expect(reads.environments).toEqual([]);
  });

  it("a run with no creator stamp reads none", async () => {
    const { data, reads } = await build(executionBy("aexec_unstamped", ""));
    expect(data["GITHUB_TOKEN"]).toBeUndefined();
    expect(reads.environments).toEqual([]);
  });
});
