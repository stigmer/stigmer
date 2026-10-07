/**
 * The ExecutionContext builder (domain/run/create-execution-context-step.ts)
 * over a real store: the run's requirements gathered per declarer, the
 * run's person and surface read from the persisted run, the one credential
 * rule (domain/credential/resolve.ts) asked, and the context persisted.
 * The rule's own cases are pinned in domain/credential/__tests__/
 * resolve.test.ts; this file pins what the builder hands it.
 *
 * Requirements, per declarer: the agent's own `env`; each MCP server the
 * agent or the session uses with its own `env` and sign-in (agent usages
 * winning over the session's by slug, a server that cannot be found
 * skipped); the git host of each workspace repository with an optional
 * GITHUB_TOKEN. The agent's env holds only the agent's keys, so a key only
 * a server declares is the server's requirement, never the agent's.
 *
 * The surface: a run with no person reads the assignments of the surface
 * that started it from the stored surface row, never the request: the
 * minting platform client named by the run's audit stamp, else the
 * schedule, share or channel its lineage label names. A run with a person
 * reads no surface at all. A surface that is gone, or belongs to another
 * organization, assigns nothing.
 *
 * Recovery rebuilds from the persisted run alone: the person recorded at
 * create and the minting client's stamp survive the runner's status writes.
 * The agent half is the agent the turn recorded at create: a turn with a
 * recorded version declares that version's env, never the agent's head; a
 * recorded version that no longer resolves refuses, naming it.
 *
 * And the create step around the builder: runtime_env reaches the context
 * and is cleared from the run, so no secret is persisted on it; a turn with
 * no session id refuses before any read; a refusal of the rule fails the
 * create before any context is written.
 */
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentVersionEntrySchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/version_pb";
import type { AgentVersionEntry } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/version_pb";
import { AgentChannelSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import { AgentShareSchema } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/api_pb";
import { CredentialSchema } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/api_pb";
import type {
  CredentialAssignment,
  CredentialTarget,
} from "@stigmer/protos/ai/stigmer/agentic/credential/v1/requirement_pb";
import {
  CredentialAssignmentSchema,
  CredentialTargetSchema,
} from "@stigmer/protos/ai/stigmer/agentic/credential/v1/requirement_pb";
import type { ExecutionContext } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/api_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { McpServerSignIn } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { RunUpdateStatusInputSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/io_pb";
import { ScheduleSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { PlatformClient } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/api_pb";
import { PlatformClientSchema } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/api_pb";

import { createLogger } from "../../../boot/logger.js";
import { SecretService } from "../../../encryption/encryption.js";
import type { Authorizer, AuthzCheck } from "../../../extensions/authorizer.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import type { Store } from "../../../store/interface.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import { credentialListIndex } from "../../credential/list-index.js";
import type { Requirement } from "../../credential/resolve.js";
import { GIT_TOKEN_KEY } from "../../credential/resolve.js";
import { CredentialValues } from "../../credential/values.js";

import type { ExecutionContextBuilderDeps } from "../create-execution-context-step.js";
import {
  buildAndPersistExecutionContext,
  mergeAgentAndSessionMcpUsages,
  newCreateExecutionContextStep,
  runRequirements,
  SCHEDULE_ID_LABEL_KEY,
} from "../create-execution-context-step.js";
import {
  CHANNEL_ID_LABEL_KEY,
  SHARE_ID_LABEL_KEY,
} from "../run-credentials.js";
import { applyUpdateStatusMerge } from "../update-status.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const ORG = "acme";
const OTHER = "globex";
const ANA = "acc_ana";

let dir: string;
let store: Store;

// ---------------------------------------------------------------------------
// The organization the runs below run in: an agent, three MCP servers (a
// personal sign-in, an organization sign-in, and one with no sign-in),
// Ana's own credentials, the organization's, and a team key surfaces
// assign.
// ---------------------------------------------------------------------------

function agentTarget(org: string, slug: string): CredentialTarget {
  return create(CredentialTargetSchema, {
    target: {
      case: "agent",
      value: { kind: ApiResourceKind.agent, org, slug },
    },
  });
}

function serverTarget(org: string, slug: string): CredentialTarget {
  return create(CredentialTargetSchema, {
    target: {
      case: "mcpServer",
      value: { kind: ApiResourceKind.mcp_server, org, slug },
    },
  });
}

function hostTarget(host: string): CredentialTarget {
  return create(CredentialTargetSchema, {
    target: { case: "gitHost", value: host },
  });
}

async function saveServer(
  org: string,
  slug: string,
  env: Record<string, { isSecret?: boolean; optional?: boolean }>,
  signIn: McpServerSignIn = McpServerSignIn.unspecified,
): Promise<void> {
  const id = `mcps_${org}_${slug}`;
  await store.saveResource(
    ApiResourceKind.mcp_server,
    id,
    McpServerSchema,
    create(McpServerSchema, {
      metadata: { id, org, slug },
      spec: { env, signIn },
    }),
  );
}

async function saveCredential(init: {
  org: string;
  slug: string;
  owner: { person: string } | { org: string };
  fields: Record<string, string>;
  serves?: CredentialTarget[];
}): Promise<void> {
  const id = `cred_${init.org}_${init.slug}`;
  await store.saveResource(
    ApiResourceKind.credential,
    id,
    CredentialSchema,
    create(CredentialSchema, {
      metadata: { id, org: init.org, slug: init.slug },
      spec: {
        owner:
          "person" in init.owner
            ? { case: "person", value: init.owner.person }
            : { case: "org", value: init.owner.org },
        fields: Object.fromEntries(
          Object.entries(init.fields).map(([name, value]) => [
            name,
            { value, plain: true },
          ]),
        ),
        serves: init.serves ?? [],
      },
    }),
  );
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "run-ecbuilder-test-"));
  store = SqliteStore.open(path.join(dir, "stigmer.db"), undefined, {
    listIndexes: [credentialListIndex],
  });

  await saveServer(
    ORG,
    "notes",
    { NOTES_TOKEN: { isSecret: true } },
    McpServerSignIn.personal,
  );
  await saveServer(
    ORG,
    "crm",
    { CRM_TOKEN: { isSecret: true } },
    McpServerSignIn.organization,
  );
  await saveServer(ORG, "search", {
    SEARCH_REGION: { isSecret: false, optional: true },
  });

  await saveCredential({
    org: ORG,
    slug: "ana-keys",
    owner: { person: ANA },
    fields: {
      API_KEY: "ana-key",
      NOTES_TOKEN: "nt-ana",
      [GIT_TOKEN_KEY]: "ghp-ana",
    },
    serves: [
      agentTarget(ORG, "helper"),
      serverTarget(ORG, "notes"),
      hostTarget("github.com"),
    ],
  });
  await saveCredential({
    org: ORG,
    slug: "crm-sign-in",
    owner: { org: ORG },
    fields: { CRM_TOKEN: "crm-team" },
    serves: [serverTarget(ORG, "crm")],
  });
  await saveCredential({
    org: ORG,
    slug: "team-key",
    owner: { org: ORG },
    fields: { API_KEY: "team-key" },
  });
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// The builder's deps.
// ---------------------------------------------------------------------------

/** The agent "helper": API_KEY of its own, and the notes server. */
const HELPER = create(AgentSchema, {
  metadata: { id: "agt_helper", org: ORG, slug: "helper" },
  spec: {
    env: { API_KEY: { isSecret: true } },
    mcpServerUsages: [{ mcpServerRef: { org: ORG, slug: "notes" } }],
  },
});

/** Allows `can_use` for the "principal|credential id" pairs given; records every check. */
function authorizerAllowing(
  allowed: ReadonlyArray<string>,
  asked: AuthzCheck[] = [],
): Authorizer {
  return {
    authorize: async (caller, check) => {
      asked.push(check);
      return allowed.includes(`${caller.identityId}|${check.resourceId}`)
        ? { kind: "allow" }
        : { kind: "deny", reason: "not granted" };
    },
  };
}

/** The platform client port for runs no minted user created: reaching it is a failure. */
const unreadPlatformClients: ExecutionContextBuilderDeps["platformClients"] = {
  findById: async () => {
    throw new Error("no minting client: the client must not be read");
  },
};

function builderDeps(opts: {
  createdEcs: ExecutionContext[];
  agent?: Agent;
  session?: (sessionId: string) => Session;
  authorizer?: Authorizer;
  platformClients?: ExecutionContextBuilderDeps["platformClients"];
}): ExecutionContextBuilderDeps {
  return {
    store,
    logger: silentLogger,
    agentLoader: () => ({
      get: async (agentId) => {
        if (opts.agent === undefined) {
          throw new Error(
            `no agent is read for this run (asked for ${agentId})`,
          );
        }
        return opts.agent;
      },
      getVersion: async () => {
        throw new Error("this turn records no agent version");
      },
    }),
    sessionLoader: () => ({
      get: async (sessionId) =>
        opts.session?.(sessionId) ??
        create(SessionSchema, { metadata: { id: sessionId, org: ORG } }),
    }),
    executionContextCreator: () => ({
      create: async (ec) => {
        opts.createdEcs.push(ec);
        return ec;
      },
    }),
    // The create path never deletes a context.
    executionContextDeleter: () => ({
      delete: () => Promise.reject(new Error("unused on the create path")),
    }),
    credentials: {
      store,
      logger: silentLogger,
      authorizer: opts.authorizer ?? authorizerAllowing([]),
      values: new CredentialValues(
        SecretService.create(randomBytes(32)),
        silentLogger,
      ),
      signIns: {
        freshen: async () => {
          throw new Error("no sign-in is read in this suite");
        },
      },
    },
    platformClients: opts.platformClients ?? unreadPlatformClients,
  };
}

function run(init: {
  id: string;
  person?: string;
  agentId?: string;
  labels?: Record<string, string>;
  platformClientId?: string;
  runtimeEnv?: Record<string, string>;
}): Run {
  return create(RunSchema, {
    metadata: { id: init.id, org: ORG, labels: init.labels ?? {} },
    spec: {
      target: { case: "sessionId", value: `ses_${init.id}` },
      message: "hi",
      runtimeEnv: Object.fromEntries(
        Object.entries(init.runtimeEnv ?? {}).map(([key, value]) => [
          key,
          { value, isSecret: true },
        ]),
      ),
    },
    status: {
      agentId: init.agentId ?? "",
      credentials: { person: init.person ?? "" },
      audit:
        init.platformClientId === undefined
          ? undefined
          : {
              specAudit: {
                createdBy: { id: ANA, platformClientId: init.platformClientId },
              },
            },
    },
  });
}

/** The values a built context holds, as key → value. */
function dataOf(ec: ExecutionContext | undefined): Record<string, string> {
  return Object.fromEntries(
    Object.entries(ec?.spec?.data ?? {}).map(([key, value]) => [
      key,
      value.value,
    ]),
  );
}

async function refusalOf(promise: Promise<unknown>): Promise<ConnectError> {
  const failure = await promise.then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(failure).toBeInstanceOf(ConnectError);
  return failure as ConnectError;
}

function literal(
  declarer: CredentialTarget,
  key: string,
  value: string,
): CredentialAssignment {
  return create(CredentialAssignmentSchema, {
    requirement: { declarer, key },
    source: { case: "literal", value },
  });
}

function teamKeyAssignment(
  declarer: CredentialTarget,
  key: string,
  writer: string,
): CredentialAssignment {
  return create(CredentialAssignmentSchema, {
    requirement: { declarer, key },
    source: {
      case: "credential",
      value: {
        credential: {
          kind: ApiResourceKind.credential,
          org: ORG,
          slug: "team-key",
        },
      },
    },
    writer,
  });
}

async function saveSchedule(
  id: string,
  org: string,
  credentials: CredentialAssignment[],
): Promise<void> {
  await store.saveResource(
    ApiResourceKind.schedule,
    id,
    ScheduleSchema,
    create(ScheduleSchema, {
      metadata: { id, org, slug: id },
      spec: { target: { case: "agent", value: { credentials } } },
    }),
  );
}

function platformClient(
  id: string,
  org: string,
  credentials: CredentialAssignment[],
): PlatformClient {
  return create(PlatformClientSchema, {
    metadata: { id, org, slug: id },
    spec: { credentials },
  });
}

// ---------------------------------------------------------------------------

describe("requirements, per declarer", () => {
  const notes = create(McpServerSchema, {
    metadata: { id: "mcps_notes", org: ORG, slug: "notes" },
    spec: {
      env: { NOTES_TOKEN: { isSecret: true } },
      signIn: McpServerSignIn.personal,
    },
  });

  it("gathers the agent's env, each server's env with its sign-in, and each workspace git host", () => {
    const session = create(SessionSchema, {
      spec: {
        workspaceEntries: [
          {
            name: "app",
            source: {
              source: {
                case: "gitRepo",
                value: { url: "https://GitHub.com/acme/app" },
              },
            },
          },
          {
            name: "lib",
            source: {
              source: {
                case: "gitRepo",
                value: { url: "https://github.com/acme/lib" },
              },
            },
          },
          {
            name: "ops",
            source: {
              source: {
                case: "gitRepo",
                value: { url: "https://gitlab.example/acme/ops" },
              },
            },
          },
          {
            name: "local",
            source: {
              source: { case: "localPath", value: { path: "/tmp/x" } },
            },
          },
          {
            name: "junk",
            source: {
              source: { case: "gitRepo", value: { url: "not a url" } },
            },
          },
        ],
      },
    });

    const requirements = runRequirements(
      { org: ORG, slug: "helper", spec: HELPER.spec },
      [notes],
      session,
    );

    const expected: Requirement[] = [
      {
        declarer: { kind: "agent", org: ORG, slug: "helper" },
        key: "API_KEY",
        declaration: { isSecret: true, optional: false },
      },
      {
        declarer: {
          kind: "mcp_server",
          id: "mcps_notes",
          org: ORG,
          slug: "notes",
          signIn: McpServerSignIn.personal,
        },
        key: "NOTES_TOKEN",
        declaration: { isSecret: true, optional: false },
      },
      {
        declarer: { kind: "git_host", host: "github.com" },
        key: GIT_TOKEN_KEY,
        declaration: { isSecret: true, optional: true },
      },
      {
        declarer: { kind: "git_host", host: "gitlab.example" },
        key: GIT_TOKEN_KEY,
        declaration: { isSecret: true, optional: true },
      },
    ];
    expect(
      requirements.map((r) => ({
        declarer: r.declarer,
        key: r.key,
        declaration: {
          isSecret: r.declaration.isSecret,
          optional: r.declaration.optional,
        },
      })),
    ).toEqual(expected);
  });

  it("a key only a server declares is the server's requirement, never the agent's", () => {
    const requirements = runRequirements(
      {
        org: ORG,
        slug: "quiet",
        spec: create(AgentSchema, {
          spec: {
            mcpServerUsages: [{ mcpServerRef: { org: ORG, slug: "notes" } }],
          },
        }).spec,
      },
      [notes],
      undefined,
    );

    expect(requirements.map((r) => [r.declarer.kind, r.key])).toEqual([
      ["mcp_server", "NOTES_TOKEN"],
    ]);
  });

  it("the built-in assistant declares no agent half", () => {
    expect(
      runRequirements(undefined, [notes], undefined).map(
        (r) => r.declarer.kind,
      ),
    ).toEqual(["mcp_server"]);
  });

  it("unites the agent's and the session's server usages, the agent's winning by slug", () => {
    const merged = mergeAgentAndSessionMcpUsages(
      create(AgentSchema, {
        spec: {
          mcpServerUsages: [{ mcpServerRef: { org: ORG, slug: "notes" } }],
        },
      }).spec,
      create(SessionSchema, {
        spec: {
          mcpServerUsages: [
            { mcpServerRef: { org: OTHER, slug: "notes" } },
            { mcpServerRef: { org: ORG, slug: "crm" } },
          ],
        },
      }),
    );

    expect(
      merged.map((u) => [u.mcpServerRef?.org, u.mcpServerRef?.slug]),
    ).toEqual([
      [ORG, "notes"],
      [ORG, "crm"],
    ]);
  });
});

describe("a person's run", () => {
  it("receives each declarer's value: the agent's, the agent's server, the session's server and the git host", async () => {
    const createdEcs: ExecutionContext[] = [];
    const asked: AuthzCheck[] = [];
    const deps = builderDeps({
      createdEcs,
      agent: HELPER,
      authorizer: authorizerAllowing([], asked),
      session: (sessionId) =>
        create(SessionSchema, {
          metadata: { id: sessionId, org: ORG },
          spec: {
            mcpServerUsages: [
              { mcpServerRef: { slug: "crm" } },
              { mcpServerRef: { org: ORG, slug: "search" } },
              { mcpServerRef: { org: ORG, slug: "not-a-server" } },
            ],
            workspaceEntries: [
              {
                name: "app",
                source: {
                  source: {
                    case: "gitRepo",
                    value: { url: "https://github.com/acme/app" },
                  },
                },
              },
            ],
          },
        }),
    });

    await buildAndPersistExecutionContext(
      deps,
      run({ id: "run_person_all", person: ANA, agentId: "agt_helper" }),
    );

    expect(createdEcs).toHaveLength(1);
    const ec = createdEcs[0];
    expect(ec?.metadata?.name).toBe("exec-ctx-run_person_all");
    expect(ec?.metadata?.org).toBe(ORG);
    expect(ec?.spec?.executionId).toBe("run_person_all");
    expect(dataOf(ec)).toEqual({
      API_KEY: "ana-key",
      NOTES_TOKEN: "nt-ana",
      // The crm server signs in for the whole organization.
      CRM_TOKEN: "crm-team",
      [GIT_TOKEN_KEY]: "ghp-ana",
    });
    expect(ec?.spec?.data["API_KEY"]?.isSecret).toBe(true);
    // Every value was the person's own or an organization sign-in's.
    expect(asked).toEqual([]);
  });

  it("ignores the surface labels and the minting client's stamp", async () => {
    await saveSchedule("sch_ignored", ORG, [
      literal(agentTarget(ORG, "helper"), "API_KEY", "from-schedule"),
    ]);
    const createdEcs: ExecutionContext[] = [];

    await buildAndPersistExecutionContext(
      builderDeps({ createdEcs, agent: HELPER }),
      run({
        id: "run_person_labels",
        person: ANA,
        agentId: "agt_helper",
        labels: { [SCHEDULE_ID_LABEL_KEY]: "sch_ignored" },
        platformClientId: "pcl_ignored",
      }),
    );

    expect(dataOf(createdEcs[0])["API_KEY"]).toBe("ana-key");
  });

  it("a required key nothing provides fails the create before any context is written", async () => {
    const createdEcs: ExecutionContext[] = [];

    const refusal = await refusalOf(
      buildAndPersistExecutionContext(
        builderDeps({ createdEcs, agent: HELPER }),
        run({
          id: "run_person_missing",
          person: "acc_ben",
          agentId: "agt_helper",
        }),
      ),
    );

    expect(refusal.code).toBe(Code.FailedPrecondition);
    expect(refusal.rawMessage).toContain("agent 'helper' needs API_KEY");
    expect(refusal.rawMessage).toContain(
      "MCP server 'notes' needs NOTES_TOKEN",
    );
    expect(createdEcs).toEqual([]);
  });
});

describe("the surface of a run with no person", () => {
  it("a schedule's run reads the schedule's assignments", async () => {
    await saveSchedule("sch_nightly", ORG, [
      literal(agentTarget(ORG, "helper"), "API_KEY", "nightly-key"),
      literal(serverTarget(ORG, "notes"), "NOTES_TOKEN", "nightly-notes"),
    ]);
    const createdEcs: ExecutionContext[] = [];

    await buildAndPersistExecutionContext(
      builderDeps({ createdEcs, agent: HELPER }),
      run({
        id: "run_schedule",
        agentId: "agt_helper",
        labels: { [SCHEDULE_ID_LABEL_KEY]: "sch_nightly" },
      }),
    );

    expect(dataOf(createdEcs[0])).toEqual({
      API_KEY: "nightly-key",
      NOTES_TOKEN: "nightly-notes",
    });
  });

  it("a share link's run reads the share's assignments, its writer asked can_use again", async () => {
    await store.saveResource(
      ApiResourceKind.agent_share,
      "shr_public",
      AgentShareSchema,
      create(AgentShareSchema, {
        metadata: { id: "shr_public", org: ORG },
        spec: {
          credentials: [
            teamKeyAssignment(agentTarget(ORG, "helper"), "API_KEY", ANA),
            literal(serverTarget(ORG, "notes"), "NOTES_TOKEN", "share-notes"),
          ],
        },
      }),
    );
    const createdEcs: ExecutionContext[] = [];
    const asked: AuthzCheck[] = [];

    await buildAndPersistExecutionContext(
      builderDeps({
        createdEcs,
        agent: HELPER,
        authorizer: authorizerAllowing([`${ANA}|cred_${ORG}_team-key`], asked),
      }),
      run({
        id: "run_share",
        agentId: "agt_helper",
        labels: { [SHARE_ID_LABEL_KEY]: "shr_public" },
      }),
    );

    expect(dataOf(createdEcs[0])).toEqual({
      API_KEY: "team-key",
      NOTES_TOKEN: "share-notes",
    });
    expect(asked.map((c) => c.resourceId)).toEqual([`cred_${ORG}_team-key`]);
  });

  it("a channel's run reads the channel's assignments", async () => {
    await store.saveResource(
      ApiResourceKind.agent_channel,
      "ach_support",
      AgentChannelSchema,
      create(AgentChannelSchema, {
        metadata: { id: "ach_support", org: ORG },
        spec: {
          credentials: [
            literal(agentTarget(ORG, "helper"), "API_KEY", "channel-key"),
            literal(serverTarget(ORG, "notes"), "NOTES_TOKEN", "channel-notes"),
          ],
        },
      }),
    );
    const createdEcs: ExecutionContext[] = [];

    await buildAndPersistExecutionContext(
      builderDeps({ createdEcs, agent: HELPER }),
      run({
        id: "run_channel",
        agentId: "agt_helper",
        labels: { [CHANNEL_ID_LABEL_KEY]: "ach_support" },
      }),
    );

    expect(dataOf(createdEcs[0])).toEqual({
      API_KEY: "channel-key",
      NOTES_TOKEN: "channel-notes",
    });
  });

  it("a minted user's run reads its platform client's assignments, before any label", async () => {
    await saveSchedule("sch_under_client", ORG, [
      literal(agentTarget(ORG, "helper"), "API_KEY", "from-schedule"),
    ]);
    const reads: string[] = [];
    const createdEcs: ExecutionContext[] = [];

    await buildAndPersistExecutionContext(
      builderDeps({
        createdEcs,
        agent: HELPER,
        platformClients: {
          findById: async (id) => {
            reads.push(id);
            return platformClient(id, ORG, [
              literal(agentTarget(ORG, "helper"), "API_KEY", "client-key"),
              literal(
                serverTarget(ORG, "notes"),
                "NOTES_TOKEN",
                "client-notes",
              ),
            ]);
          },
        },
      }),
      run({
        id: "run_client",
        agentId: "agt_helper",
        platformClientId: "pcl_dashboard",
        labels: { [SCHEDULE_ID_LABEL_KEY]: "sch_under_client" },
      }),
    );

    expect(reads).toEqual(["pcl_dashboard"]);
    expect(dataOf(createdEcs[0])).toEqual({
      API_KEY: "client-key",
      NOTES_TOKEN: "client-notes",
    });
  });

  it("reaches neither the creator's own credentials nor the organization's sign-in", async () => {
    await saveSchedule("sch_bare", ORG, []);
    const createdEcs: ExecutionContext[] = [];

    await buildAndPersistExecutionContext(
      builderDeps({
        createdEcs,
        session: (sessionId) =>
          create(SessionSchema, {
            metadata: { id: sessionId, org: ORG },
            spec: {
              mcpServerUsages: [{ mcpServerRef: { org: ORG, slug: "search" } }],
              workspaceEntries: [
                {
                  name: "app",
                  source: {
                    source: {
                      case: "gitRepo",
                      value: { url: "https://github.com/acme/app" },
                    },
                  },
                },
              ],
            },
          }),
      }),
      run({ id: "run_bare", labels: { [SCHEDULE_ID_LABEL_KEY]: "sch_bare" } }),
    );

    // Ana's GitHub token serves github.com, but this run has no person.
    expect(dataOf(createdEcs[0])).toEqual({});
  });

  it("a schedule of another organization assigns nothing", async () => {
    await saveSchedule("sch_foreign", OTHER, [
      literal(agentTarget(ORG, "helper"), "API_KEY", "foreign-key"),
    ]);

    const refusal = await refusalOf(
      buildAndPersistExecutionContext(
        builderDeps({ createdEcs: [], agent: HELPER }),
        run({
          id: "run_foreign_schedule",
          agentId: "agt_helper",
          labels: { [SCHEDULE_ID_LABEL_KEY]: "sch_foreign" },
        }),
      ),
    );

    expect(refusal.code).toBe(Code.FailedPrecondition);
    expect(refusal.rawMessage).toContain(
      "agent 'helper' needs API_KEY, and a run with no person behind it uses only what is assigned on the schedule that started it",
    );
    expect(refusal.rawMessage).not.toContain("foreign-key");
  });

  it("a deleted schedule assigns nothing", async () => {
    const refusal = await refusalOf(
      buildAndPersistExecutionContext(
        builderDeps({ createdEcs: [], agent: HELPER }),
        run({
          id: "run_gone_schedule",
          agentId: "agt_helper",
          labels: { [SCHEDULE_ID_LABEL_KEY]: "sch_deleted" },
        }),
      ),
    );

    expect(refusal.code).toBe(Code.FailedPrecondition);
    expect(refusal.rawMessage).toContain("agent 'helper' needs API_KEY");
  });

  it("a platform client of another organization, or one deleted since, assigns nothing", async () => {
    for (const client of [
      platformClient("pcl_dashboard", OTHER, [
        literal(agentTarget(ORG, "helper"), "API_KEY", "foreign-key"),
      ]),
      undefined,
    ]) {
      const refusal = await refusalOf(
        buildAndPersistExecutionContext(
          builderDeps({
            createdEcs: [],
            agent: HELPER,
            platformClients: { findById: async () => client },
          }),
          run({
            id: "run_client_foreign",
            agentId: "agt_helper",
            platformClientId: "pcl_dashboard",
          }),
        ),
      );
      expect(refusal.code).toBe(Code.FailedPrecondition);
      expect(refusal.rawMessage).toContain("agent 'helper' needs API_KEY");
      expect(refusal.rawMessage).not.toContain("foreign-key");
    }
  });

  it("refuses an assignment whose writer may no longer use its credential, naming the surface", async () => {
    await saveSchedule("sch_revoked", ORG, [
      teamKeyAssignment(agentTarget(ORG, "helper"), "API_KEY", "acc_left"),
    ]);
    const createdEcs: ExecutionContext[] = [];

    const refusal = await refusalOf(
      buildAndPersistExecutionContext(
        builderDeps({ createdEcs, agent: HELPER }),
        run({
          id: "run_revoked",
          agentId: "agt_helper",
          labels: { [SCHEDULE_ID_LABEL_KEY]: "sch_revoked" },
          runtimeEnv: { NOTES_TOKEN: "per-call" },
        }),
      ),
    );

    expect(refusal.code).toBe(Code.FailedPrecondition);
    expect(refusal.rawMessage).toBe(
      "this run cannot start: whoever assigned API_KEY on the schedule (credential 'team-key') may no longer use that credential; reassign it",
    );
    expect(createdEcs).toEqual([]);
  });

  it("a platform client that cannot be read fails the create naming it", async () => {
    const failure = await buildAndPersistExecutionContext(
      builderDeps({
        createdEcs: [],
        agent: HELPER,
        platformClients: {
          findById: async () => {
            throw new Error("connection reset");
          },
        },
      }),
      run({
        id: "run_client_fault",
        agentId: "agt_helper",
        platformClientId: "pcl_dashboard",
      }),
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(
      "load platform client pcl_dashboard for credential resolution: connection reset",
    );
  });
});

describe("recovery", () => {
  it("the recorded person and the minting client's stamp survive the runner's status writes", async () => {
    const turn = run({
      id: "run_recover",
      person: ANA,
      agentId: "agt_helper",
      platformClientId: "pcl_dashboard",
    });
    applyUpdateStatusMerge(
      turn,
      create(RunUpdateStatusInputSchema, {
        runId: "run_recover",
        status: { phase: RunPhase.RUN_FAILED, error: "boom" },
      }),
      silentLogger,
    );
    expect(turn.status?.credentials?.person).toBe(ANA);
    expect(turn.status?.audit?.specAudit?.createdBy?.platformClientId).toBe(
      "pcl_dashboard",
    );

    // Rebuilt from the persisted run alone: the recorded person's values,
    // and no surface read for a run that has one.
    const createdEcs: ExecutionContext[] = [];
    await buildAndPersistExecutionContext(
      builderDeps({ createdEcs, agent: HELPER }),
      turn,
    );
    expect(dataOf(createdEcs[0])).toEqual({
      API_KEY: "ana-key",
      NOTES_TOKEN: "nt-ana",
    });
  });
});

// ---------------------------------------------------------------------------
// The agent half is the agent the turn recorded at create.
// ---------------------------------------------------------------------------

const RECORDED_HASH = "e".repeat(64);

/**
 * The recorded-agent deps: the agent's head declaring HEAD_KEY (read for
 * where the agent lives, never for what it declares), the recorded
 * version as `version` answers it.
 */
function recordedAgentDeps(
  version: () => Promise<AgentVersionEntry>,
  createdEcs: ExecutionContext[],
): ExecutionContextBuilderDeps {
  const deps = builderDeps({ createdEcs });
  return {
    ...deps,
    agentLoader: () => ({
      get: async () =>
        create(AgentSchema, {
          metadata: { id: "agt_rec", org: ORG, slug: "rec-agent" },
          spec: { env: { HEAD_KEY: { optional: true } } },
        }),
      getVersion: version,
    }),
  };
}

/** A persisted turn that recorded agt_rec at RECORDED_HASH, as recover reads it. */
function recordedTurn(
  id: string,
  runtimeEnv: Record<string, string> = {},
): Run {
  const turn = run({ id, agentId: "agt_rec", runtimeEnv });
  turn.status!.agentVersionHash = RECORDED_HASH;
  return turn;
}

describe("the agent the turn recorded", () => {
  it("rebuilds from the version the turn recorded, after the head moved (the recover path)", async () => {
    const createdEcs: ExecutionContext[] = [];
    const asked: Array<[string, string]> = [];
    const deps = recordedAgentDeps(async () => {
      asked.push(["agt_rec", RECORDED_HASH]);
      return create(AgentVersionEntrySchema, {
        versionHash: RECORDED_HASH,
        specSnapshot: { env: { RECORDED_KEY: {} } },
      });
    }, createdEcs);

    await buildAndPersistExecutionContext(
      deps,
      recordedTurn("run_recorded", {
        RECORDED_KEY: "declared-by-the-recorded-version",
        HEAD_KEY: "declared-by-the-head-only",
      }),
    );

    expect(asked).toEqual([["agt_rec", RECORDED_HASH]]);
    expect(dataOf(createdEcs[0])).toEqual({
      RECORDED_KEY: "declared-by-the-recorded-version",
    });
  });

  it("refuses, naming the version, when the recorded version no longer resolves", async () => {
    const deps = recordedAgentDeps(async () => {
      throw new ConnectError("agent version not found", Code.NotFound);
    }, []);

    const failure = await buildAndPersistExecutionContext(
      deps,
      recordedTurn("run_recorded_gone"),
    ).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(ConnectError);
    expect((failure as ConnectError).code).toBe(Code.NotFound);
    expect((failure as ConnectError).rawMessage).toContain(RECORDED_HASH);
  });

  it("keeps a recorded-version load failure that is not a status as its message, naming the version", async () => {
    const deps = recordedAgentDeps(async () => {
      throw new Error("socket hang up");
    }, []);

    const failure = await buildAndPersistExecutionContext(
      deps,
      recordedTurn("run_recorded_fault"),
    ).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain(RECORDED_HASH);
    expect((failure as Error).message).toContain("socket hang up");
  });

  it("loads a turn that recorded its agent without a version as the agent is now, keeping a refusal's code", async () => {
    const deps: ExecutionContextBuilderDeps = {
      ...builderDeps({ createdEcs: [] }),
      agentLoader: () => ({
        get: async () => {
          throw new ConnectError("agent not found", Code.NotFound);
        },
        getVersion: async () => {
          throw new Error("no version is recorded on this turn");
        },
      }),
    };

    const failure = await buildAndPersistExecutionContext(
      deps,
      run({ id: "run_unversioned", agentId: "agt_rec" }),
    ).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(ConnectError);
    expect((failure as ConnectError).code).toBe(Code.NotFound);
    expect((failure as ConnectError).rawMessage).toContain(
      "load agent agt_rec",
    );
  });

  it("keeps a head-load failure that is not a status as its message", async () => {
    const deps: ExecutionContextBuilderDeps = {
      ...builderDeps({ createdEcs: [] }),
      agentLoader: () => ({
        get: async () => {
          throw new Error("socket hang up");
        },
        getVersion: async () => {
          throw new Error("no version is recorded on this turn");
        },
      }),
    };

    const failure = await buildAndPersistExecutionContext(
      deps,
      run({ id: "run_unversioned_fault", agentId: "agt_rec" }),
    ).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(ConnectError);
    expect((failure as Error).message).toBe(
      "load agent agt_rec: socket hang up",
    );
  });

  it("declares for the recorded agent when the session has since moved to the built-in assistant", async () => {
    const createdEcs: ExecutionContext[] = [];
    const deps = recordedAgentDeps(
      async () =>
        create(AgentVersionEntrySchema, {
          versionHash: RECORDED_HASH,
          specSnapshot: { env: { RECORDED_KEY: {} } },
        }),
      createdEcs,
    );

    await buildAndPersistExecutionContext(
      deps,
      recordedTurn("run_moved", { RECORDED_KEY: "kept", HEAD_KEY: "dropped" }),
    );

    expect(dataOf(createdEcs[0])).toEqual({ RECORDED_KEY: "kept" });
  });

  it("declares no agent half for a turn with no stamp, whatever its session pins", async () => {
    const createdEcs: ExecutionContext[] = [];
    const deps = builderDeps({
      createdEcs,
      // No agent: reaching the agent loader would fail the build.
      session: (sessionId) =>
        create(SessionSchema, {
          metadata: { id: sessionId, org: ORG },
          spec: { agentRef: { org: ORG, slug: "helper" } },
          status: { agentId: "agt_helper" },
        }),
    });

    await buildAndPersistExecutionContext(
      deps,
      run({
        id: "run_unstamped",
        person: ANA,
        runtimeEnv: { API_KEY: "undeclared" },
      }),
    );

    // Nothing declares API_KEY, so neither the per-call value nor Ana's
    // credential for the pinned agent reaches the run.
    expect(dataOf(createdEcs[0])).toEqual({});
  });
});

describe("the create step", () => {
  it("consumes runtime_env into the context and clears it from the run", async () => {
    const createdEcs: ExecutionContext[] = [];
    const ctx = new RequestContext(
      RunSchema,
      run({
        id: "run_step_clear",
        person: ANA,
        agentId: "agt_helper",
        runtimeEnv: { API_KEY: "per-call" },
      }),
      testCallerIdentity(),
      ApiResourceKind.run,
    );

    await newCreateExecutionContextStep(
      builderDeps({ createdEcs, agent: HELPER }),
    ).execute(ctx);

    expect(dataOf(createdEcs[0])["API_KEY"]).toBe("per-call");
    expect(ctx.newState.spec?.runtimeEnv).toEqual({});
  });

  it("refuses a turn with no session id before reading anything", async () => {
    const createdEcs: ExecutionContext[] = [];
    const deps: ExecutionContextBuilderDeps = {
      ...builderDeps({ createdEcs }),
      sessionLoader: () => ({
        get: async () => {
          throw new Error("a turn with no session id reads no session");
        },
      }),
    };
    const turn = create(RunSchema, {
      metadata: { id: "run_no_session", org: ORG },
      spec: { message: "hi" },
    });

    const failure = await buildAndPersistExecutionContext(deps, turn).catch(
      (e: unknown) => e,
    );

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(
      "resolve session: no session_id on execution",
    );
    expect(createdEcs).toEqual([]);
  });
});
