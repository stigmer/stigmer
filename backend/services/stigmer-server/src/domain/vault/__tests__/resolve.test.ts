/**
 * Pins the run's credential resolver (domain/vault/resolve.ts) over a real
 * store and vault service, with a table Authorizer for `can_use`. Each arm
 * plans a run (planRun, as create does), stamps the manifest on it, and
 * opens it (openRun, as the runner's fetch does):
 *
 *   - requirements: the agent's keys (never one a tool of the run declares,
 *     in its env or as its login), each tool's keys and its login key
 *     (auth.target_env_var, or the variable an `Authorization: Bearer
 *     ${VAR}` header names), and an optional GITHUB_TOKEN per repository;
 *   - the order of sources: a repository's own token (its clone only),
 *     then the sender's My vault when the stored conversation includes it,
 *     then its listed vaults in order, then the surface's vaults for a run
 *     with no person; a conversation that leaves My vault out never reads
 *     it, listing vaults or not; an agent's run reads only what its
 *     conversation chose, never a shared vault it did not list; a run with
 *     no person never reads a My vault (include_my_vault ignored) but its
 *     owner's own schedule attachment;
 *   - every named vault checked when planned and again when opened: a
 *     surface vault whose attacher lost the use, a vault that is gone, a
 *     use revoked after the plan, a vault the conversation no longer lists
 *     and My vault left out after the plan refuse, naming it; someone
 *     else's My vault listed on a conversation refuses;
 *   - matching per declarer: a tool's login by its address first, then (a
 *     tool on GitHub's own API only) the github.com login, then a secret by
 *     name; a clone by its own token (the entry of that name and URL), then
 *     the github.com login, then a GITHUB_TOKEN secret; the agent's keys by
 *     secret name, then its plain value, never a connection or a
 *     repository's token; two declarers of one key take their own values,
 *     and a login never reaches a declarer it was not made for (that
 *     declarer is refused as missing the key, or receives nothing when its
 *     key is optional);
 *   - a missing required key refused naming what the conversation lacks,
 *     one sentence per case; an optional one absent;
 *   - planning opens and renews nothing; the fetch renews a sign-in once
 *     per connection, writing it back as the server acting for the run's
 *     person; a refused renewal refuses the fetch, any other renewal fault
 *     INTERNAL without its text;
 *   - the fetch reads each entry as it is now: a rotated secret is picked
 *     up, an entry removed since refuses naming the key, its declarer and
 *     the vault, and a tool moved to another address since refuses its
 *     login; each tool's URL is answered as read, none for a local program;
 *   - the surfaces found from server-stamped facts: the minting platform
 *     client, the schedule, the share and the channel (each of another
 *     organization contributes nothing);
 *   - a run of an agent of another organization, or one whose row cannot
 *     be read, reads no My vault for any requirement;
 *   - every value from a vault, a connection or a repository's token is
 *     delivered as secret; only a declaration's own plain value stays plain;
 *   - a stored value the server cannot open refuses the fetch with the
 *     decryption error, never its ciphertext passed on; a value the run
 *     does not carry is never decrypted;
 *   - the connect lane: the connecting person's My vault only, none for a
 *     caller who is no person, never a shared vault.
 */
import { randomBytes } from "node:crypto";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import type { AgentSpec } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { AgentChannelSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import { AgentShareSchema } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/api_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { RunCredentialsSchema, RunSchema, RunStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { Run, RunValueSource } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { ExecutionValues } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/values_pb";
import { ScheduleSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { VaultSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import { VaultConnectionSource, VaultSecretSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { PlatformClientSchema } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/api_pb";
import type { PlatformClient } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/api_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import {
  DecryptionFailedError,
  ENCRYPTED_PREFIX,
  EncryptionDisabledError,
  EncryptionScope,
  GCM_NONCE_SIZE,
  REDACTED_MARKER,
  SecretService,
} from "../../../encryption/encryption.js";
import type { Authorizer } from "../../../extensions/authorizer.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { newSignInFreshener } from "../sign-in/refresh.js";

import {
  CHANNEL_ID_LABEL_KEY,
  CLONE_TOKEN_KEY,
  SCHEDULE_ID_LABEL_KEY,
  SHARE_ID_LABEL_KEY,
  SignInRenewalError,
  loginKeyOf,
  newVaultResolver,
  runRequirements,
} from "../resolve.js";
import type { SignInFreshener, VaultResolver } from "../resolve.js";
import { newVaultService } from "../service.js";
import type { VaultRig } from "./support.js";
import { openVaultRig, seedSharedVault, silentLogger } from "./support.js";

const ORG = "acme";
const ANA = "ida_ana";
const BEN = "ida_ben";
const ADMIN = "ida_admin";

let rig: VaultRig;
/** Who may use which vault, as "principal:vaultId". */
let mayUse: Set<string>;
let freshened: string[];
/** The caller each renewal was written back as. */
let renewedAs: CallerIdentity[];
let freshenFails: boolean;
let clients: Map<string, PlatformClient>;
let resolver: VaultResolver;

const useTable: Authorizer = {
  authorize: async (caller, check) => {
    if (check.permission !== IamPermission.can_use) {
      return { kind: "allow" };
    }
    return mayUse.has(`${caller.identityId}:${check.resourceId}`)
      ? { kind: "allow" }
      : { kind: "deny", reason: "may not use it" };
  },
};

const freshener: SignInFreshener = {
  freshToken: async (vault, connection, caller) => {
    freshened.push(`${vault.metadata?.id}|${connection.address}`);
    renewedAs.push(caller);
    if (freshenFails) {
      throw new SignInRenewalError("the provider refused the refresh token");
    }
    return `fresh-${connection.token}`;
  },
};

beforeEach(() => {
  rig = openVaultRig();
  mayUse = new Set();
  freshened = [];
  renewedAs = [];
  freshenFails = false;
  clients = new Map();
  resolver = newVaultResolver({
    store: rig.store,
    logger: silentLogger,
    authorizer: useTable,
    secretService: rig.secrets,
    vaults: rig.vaults,
    platformClients: { findById: async (id) => clients.get(id) },
    freshener,
  });
});

afterEach(() => {
  rig.close();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function vaultRef(slug: string) {
  return { kind: ApiResourceKind.vault, org: ORG, slug };
}

/** A local program declaring `target` as a key: it has no address and takes no login. */
function localTool(slug: string, init: { target: string }): McpServer {
  return create(McpServerSchema, {
    metadata: { id: `mcp_${slug}`, name: slug, slug, org: ORG },
    spec: {
      serverType: { case: "stdio", value: { command: "npx" } },
      env: { [init.target]: { isSecret: true } },
    },
  });
}

function tool(
  slug: string,
  init: {
    url?: string;
    env?: Record<string, { isSecret?: boolean; optional?: boolean; value?: string }>;
    target?: string;
    headers?: Record<string, string>;
  } = {},
): McpServer {
  return create(McpServerSchema, {
    metadata: { id: `mcp_${slug}`, name: slug, slug, org: ORG },
    spec: {
      serverType: {
        case: "http",
        value: {
          url: init.url ?? `https://mcp.${slug}.example/mcp`,
          headers: init.headers ?? {},
        },
      },
      env: init.env ?? {},
      ...(init.target === undefined ? {} : { auth: { targetEnvVar: init.target } }),
    },
  });
}

function agent(
  env: Record<string, { isSecret?: boolean; optional?: boolean; value?: string }>,
): AgentSpec {
  return create(AgentSpecSchema, { env });
}

/**
 * A conversation. It includes its sender's My vault unless `includeMyVault`
 * is false, as every door that starts a conversation for a person sets it;
 * the arms that pin the flag set it explicitly.
 */
function sessionOf(init: {
  vaults?: string[];
  includeMyVault?: boolean;
  repo?: { url: string; token?: string };
  labels?: Record<string, string>;
  attachers?: Record<string, string>;
} = {}): Session {
  return create(SessionSchema, {
    metadata: { id: "ses_resolve", org: ORG, labels: init.labels ?? {} },
    spec: {
      vaults: (init.vaults ?? []).map(vaultRef),
      includeMyVault: init.includeMyVault ?? true,
      workspaceEntries:
        init.repo === undefined
          ? []
          : [
              {
                name: "app",
                source: {
                  source: {
                    case: "gitRepo",
                    value: { url: init.repo.url, token: init.repo.token ?? "" },
                  },
                },
              },
            ],
    },
    status: { vaultAttachers: init.attachers ?? {} },
  });
}

function runOf(init: {
  person?: string;
  labels?: Record<string, string>;
  platformClientId?: string;
} = {}): Run {
  return create(RunSchema, {
    metadata: { id: "run_resolve", org: ORG, labels: init.labels ?? {} },
    status: {
      credentials: init.person === undefined ? {} : { person: init.person },
      audit: {
        specAudit: {
          createdBy: { id: "ida_x", platformClientId: init.platformClientId ?? "" },
        },
      },
    },
  });
}

/** The session's stored row, as the session controller writes it before any run. */
async function stored(session: Session): Promise<Session> {
  await rig.store.saveResource(ApiResourceKind.session, session.metadata!.id, SessionSchema, session);
  return session;
}

interface ResolveInit {
  run: Run;
  session?: Session;
  agentSpec?: AgentSpec;
  /** The agent's organization; null when its row cannot be read. Defaults to the run's. */
  agentOrg?: string | null;
  tools?: McpServer[];
  /** Hands the resolver a copy without storing it first. */
  unsaved?: boolean;
}

/** The run's source manifest, as create plans it. */
async function plan(init: ResolveInit, over: VaultResolver = resolver): Promise<RunValueSource[]> {
  const session = init.session ?? sessionOf();
  if (init.unsaved !== true) {
    await stored(session);
  }
  return over.planRun({
    execution: init.run,
    session,
    agentSpec: init.agentSpec,
    agentName: "Helper",
    agentOrg: init.agentOrg === null ? undefined : (init.agentOrg ?? ORG),
    tools: init.tools ?? [],
  });
}

/**
 * Plans the run, stamps the manifest on it, then opens it as the runner's
 * fetch does: the tools stored so the fetch can load them, the run naming
 * its conversation. `between` runs after the plan and before the open.
 */
async function open(
  init: ResolveInit,
  between?: () => Promise<void>,
  over: VaultResolver = resolver,
): Promise<ExecutionValues> {
  for (const tool of init.tools ?? []) {
    await rig.store.saveResource(ApiResourceKind.mcp_server, tool.metadata!.id, McpServerSchema, tool);
  }
  const sources = await plan(init, over);
  const session = init.session ?? sessionOf();
  const run = create(RunSchema, init.run);
  run.spec = create(RunSchema, {
    spec: { target: { case: "sessionId", value: session.metadata!.id } },
  }).spec;
  (run.status ??= create(RunStatusSchema)).credentials = create(RunCredentialsSchema, {
    ...(run.status.credentials?.person === undefined ? {} : { person: run.status.credentials.person }),
    sources,
  });
  await between?.();
  return over.openRun(run);
}

/**
 * Every value the run receives, keyed by variable: the agent's, each
 * tool's and each repository's token (as GITHUB_TOKEN). A key two
 * declarers receive with different values fails the helper: such an arm
 * asserts per declarer instead.
 */
function flatten(values: ExecutionValues): Record<string, string> {
  const flat: Record<string, string> = {};
  const put = (key: string, value: string): void => {
    if (key in flat && flat[key] !== value) {
      throw new Error(`${key} reaches two declarers with different values; assert per declarer`);
    }
    flat[key] = value;
  };
  for (const [key, value] of Object.entries(values.agent)) {
    put(key, value.value);
  }
  for (const tool of values.tools) {
    for (const [key, value] of Object.entries(tool.values)) {
      put(key, value.value);
    }
  }
  for (const repository of values.repositories) {
    put(CLONE_TOKEN_KEY, repository.token);
  }
  return flat;
}

async function resolve(init: ResolveInit): Promise<Record<string, string>> {
  return flatten(await open(init));
}

/** One tool's values, by its server id. */
function toolValues(values: ExecutionValues, tool: McpServer): Record<string, string> {
  const group = values.tools.find((entry) => entry.mcpServerId === tool.metadata!.id);
  return Object.fromEntries(Object.entries(group?.values ?? {}).map(([key, value]) => [key, value.value]));
}

/** The agent's own values. */
function agentValues(values: ExecutionValues): Record<string, string> {
  return Object.fromEntries(Object.entries(values.agent).map(([key, value]) => [key, value.value]));
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

/** Ana's My vault holding `secrets`; answers its id. */
async function anasVault(secrets: Record<string, string>): Promise<string> {
  const mine = await rig.vaults.ensureMine(ORG, testCallerIdentity({ identityId: ANA }));
  await rig.vaults.setSecrets(
    mine.metadata!.id,
    Object.fromEntries(
      Object.entries(secrets).map(([name, value]) => [name, { value, description: "" }]),
    ),
    testCallerIdentity({ identityId: ANA }),
  );
  return mine.metadata!.id;
}

const KEY = { isSecret: true };

// ---------------------------------------------------------------------------
// Requirements
// ---------------------------------------------------------------------------

describe("requirements", () => {
  it("names the agent's keys, each tool's keys and login key, and an optional token per github.com repository", () => {
    const requirements = runRequirements({
      execution: runOf(),
      session: sessionOf({ repo: { url: "https://github.com/acme/app" } }),
      agentSpec: agent({ OPENAI_API_KEY: KEY }),
      agentName: "Helper",
      agentOrg: ORG,
      tools: [
        tool("linear", { target: "LINEAR_TOKEN" }),
        tool("notion", { headers: { Authorization: "Bearer ${NOTION_KEY}" } }),
      ],
    });
    const byKey = Object.fromEntries(requirements.map((r) => [r.key, r]));
    expect(byKey["OPENAI_API_KEY"]?.declarer).toEqual({ kind: "agent", name: "Helper" });
    expect(byKey["LINEAR_TOKEN"]?.loginAddress).toBe("https://mcp.linear.example/mcp");
    expect(byKey["LINEAR_TOKEN"]?.signIn).toBe(true);
    expect(byKey["NOTION_KEY"]?.loginAddress).toBe("https://mcp.notion.example/mcp");
    expect(byKey["GITHUB_TOKEN"]?.clone).toEqual({
      entryName: "app",
      url: "https://github.com/acme/app",
    });
    expect(byKey["GITHUB_TOKEN"]?.optional).toBe(true);
  });

  it("reads a login key from target_env_var first, else from a bearer header, else none", () => {
    expect(loginKeyOf(tool("a", { target: "A_TOKEN", headers: { Authorization: "Bearer ${B}" } }))).toBe("A_TOKEN");
    expect(loginKeyOf(tool("b", { headers: { authorization: "bearer ${B_KEY}" } }))).toBe("B_KEY");
    expect(loginKeyOf(tool("c", { headers: { Authorization: "Token ${C}" } }))).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Sources and their order
// ---------------------------------------------------------------------------

describe("which vaults a run uses", () => {
  it("the sender's My vault comes first when the conversation includes it, then its vaults in order", async () => {
    await anasVault({ A: "ana-mine" });
    await seedSharedVault(rig.store, ORG, "first", { secrets: { A: "from-first", B: "from-first" } });
    await seedSharedVault(rig.store, ORG, "second", { secrets: { B: "from-second", C: "from-second" } });
    mayUse.add(`${ANA}:vlt_acme_first`).add(`${ANA}:vlt_acme_second`);
    const values = await resolve({
      run: runOf({ person: ANA }),
      session: sessionOf({ vaults: ["first", "second"], includeMyVault: true }),
      agentSpec: agent({ A: KEY, B: KEY, C: KEY }),
    });
    expect(values).toEqual({ A: "ana-mine", B: "from-first", C: "from-second" });
  });

  it("a conversation that leaves My vault out never reads it: its vaults are all it has", async () => {
    await anasVault({ A: "ana-mine", B: "ana-mine" });
    await seedSharedVault(rig.store, ORG, "customer", { secrets: { B: "customer" } });
    mayUse.add(`${ANA}:vlt_acme_customer`);
    expect(
      await resolve({
        run: runOf({ person: ANA }),
        session: sessionOf({ vaults: ["customer"], includeMyVault: false }),
        agentSpec: agent({ A: { isSecret: true, optional: true }, B: KEY }),
      }),
    ).toEqual({ B: "customer" });
  });

  it("an agent's run reads only what its conversation chose: a shared vault its person may use is not read unless listed", async () => {
    await seedSharedVault(rig.store, ORG, "team", { secrets: { A: "team" } });
    mayUse.add(`${ANA}:vlt_acme_team`);
    const missing = await refusal(
      resolve({ run: runOf({ person: ANA }), agentSpec: agent({ A: KEY }) }),
    );
    expect(missing.code).toBe(Code.FailedPrecondition);
    expect(
      await resolve({
        run: runOf({ person: ANA }),
        session: sessionOf({ vaults: ["team"] }),
        agentSpec: agent({ A: KEY }),
      }),
    ).toEqual({ A: "team" });
  });

  it("a missing key names what the conversation lacks: My vault when included, its vaults or My vault when left out", async () => {
    await seedSharedVault(rig.store, ORG, "customer", { secrets: { OTHER: "x" } });
    mayUse.add(`${ANA}:vlt_acme_customer`);
    const linear = tool("linear", { target: "LINEAR_TOKEN" });
    const cases: Array<{ session: Session; agent: string; tool: string }> = [
      {
        session: sessionOf({ vaults: ["customer"], includeMyVault: true }),
        agent: "the agent Helper needs A: add A to My vault",
        tool: "linear needs LINEAR_TOKEN: sign in to linear, or add LINEAR_TOKEN to My vault",
      },
      {
        session: sessionOf({ vaults: ["customer"], includeMyVault: false }),
        agent:
          "the agent Helper needs A: add A to one of this conversation's vaults, or include My vault in this conversation",
        tool: "linear needs LINEAR_TOKEN: sign in to linear, or add LINEAR_TOKEN to one of this conversation's vaults, or include My vault in this conversation",
      },
      {
        session: sessionOf({ includeMyVault: false }),
        agent:
          "the agent Helper needs A: this conversation uses no vaults: include My vault in it, or list a vault that holds A",
        tool: "linear needs LINEAR_TOKEN: this conversation uses no vaults: include My vault in it, or list a vault that holds LINEAR_TOKEN",
      },
    ];
    for (const { session, agent: agentSentence, tool: toolSentence } of cases) {
      const forAgent = await refusal(
        resolve({ run: runOf({ person: ANA }), session, agentSpec: agent({ A: KEY }) }),
      );
      expect(forAgent.code).toBe(Code.FailedPrecondition);
      expect(forAgent.rawMessage).toBe(agentSentence);
      const forTool = await refusal(resolve({ run: runOf({ person: ANA }), session, tools: [linear] }));
      expect(forTool.code).toBe(Code.FailedPrecondition);
      expect(forTool.rawMessage).toBe(toolSentence);
    }
  });

  it("a run with no person reads no My vault, whatever the conversation includes: the surface's vaults are all it has", async () => {
    await anasVault({ A: "ana-mine" });
    await rig.store.saveResource(
      ApiResourceKind.schedule,
      "sch_nightly",
      ScheduleSchema,
      create(ScheduleSchema, {
        metadata: { id: "sch_nightly", name: "nightly", org: ORG },
        spec: { target: { case: "agent", value: { vaults: [] } } },
      }),
    );
    const failure = await refusal(
      resolve({
        run: runOf({ labels: { [SCHEDULE_ID_LABEL_KEY]: "sch_nightly" } }),
        session: sessionOf({ includeMyVault: true }),
        agentSpec: agent({ A: KEY }),
      }),
    );
    expect(failure.rawMessage).toBe(
      "the agent Helper needs A: ask the owner of schedule 'nightly' to attach a vault that holds A",
    );
  });

  it("a schedule carrying its owner's own My vault uses it, checked against the owner", async () => {
    const mine = await anasVault({ A: "ana-mine" });
    const slug = (await rig.vaults.findById(mine))!.metadata!.slug;
    await rig.store.saveResource(
      ApiResourceKind.schedule,
      "sch_own",
      ScheduleSchema,
      create(ScheduleSchema, {
        metadata: { id: "sch_own", name: "own", org: ORG },
        spec: { target: { case: "agent", value: { vaults: [vaultRef(slug)] } } },
        status: { vaultAttachers: { [mine]: ANA } },
      }),
    );
    mayUse.add(`${ANA}:${mine}`);
    expect(
      await resolve({
        run: runOf({ labels: { [SCHEDULE_ID_LABEL_KEY]: "sch_own" } }),
        agentSpec: agent({ A: KEY }),
      }),
    ).toEqual({ A: "ana-mine" });
  });

  it("a surface vault whose attacher lost the use refuses, naming it and the surface; a vault that is gone refuses too", async () => {
    const team = await seedSharedVault(rig.store, ORG, "team", { secrets: { A: "team" } });
    await rig.store.saveResource(
      ApiResourceKind.agent_share,
      "shr_public",
      AgentShareSchema,
      create(AgentShareSchema, {
        metadata: { id: "shr_public", name: "public", org: ORG },
        spec: { vaults: [vaultRef("team"), vaultRef("gone")] },
        status: { vaultAttachers: { [team.metadata!.id]: ADMIN } },
      }),
    );
    const guestRun = {
      run: runOf(),
      session: sessionOf({ labels: { [SHARE_ID_LABEL_KEY]: "shr_public" } }),
      agentSpec: agent({ A: KEY }),
    };
    const revoked = await refusal(resolve(guestRun));
    expect(revoked.rawMessage).toContain("vault 'team', named by share 'public', may no longer be used");

    mayUse.add(`${ADMIN}:${team.metadata!.id}`);
    const gone = await refusal(resolve(guestRun));
    expect(gone.rawMessage).toContain(`vault ${ORG}/gone, named by share 'public', no longer exists`);
  });

  it("a schedule that is gone contributes no vaults to its run", async () => {
    const values = await resolve({
      run: runOf({ labels: { [SCHEDULE_ID_LABEL_KEY]: "sch_gone" } }),
      agentSpec: agent({ API_KEY: { isSecret: true, optional: true } }),
    });
    expect(values).toEqual({});
  });

  it("a channel's vaults reach its runs, checked against their attacher", async () => {
    const team = await seedSharedVault(rig.store, ORG, "channel-keys", { secrets: { A: "chan" } });
    await rig.store.saveResource(
      ApiResourceKind.agent_channel,
      "ach_slack",
      AgentChannelSchema,
      create(AgentChannelSchema, {
        metadata: { id: "ach_slack", name: "slack", org: ORG },
        spec: { vaults: [vaultRef("channel-keys")] },
        status: { vaultAttachers: { [team.metadata!.id]: ADMIN } },
      }),
    );
    mayUse.add(`${ADMIN}:${team.metadata!.id}`);
    expect(
      await resolve({
        run: runOf(),
        session: sessionOf({ labels: { [CHANNEL_ID_LABEL_KEY]: "ach_slack" } }),
        agentSpec: agent({ A: KEY }),
      }),
    ).toEqual({ A: "chan" });
  });

  it("a minted user's run uses its platform client's vaults; another organization's client contributes nothing", async () => {
    const embed = await seedSharedVault(rig.store, ORG, "embed", { secrets: { A: "embed" } });
    mayUse.add(`${ADMIN}:${embed.metadata!.id}`);
    clients.set(
      "pcl_dash",
      create(PlatformClientSchema, {
        metadata: { id: "pcl_dash", name: "dashboard", org: ORG },
        spec: { vaults: [vaultRef("embed")] },
        status: { vaultAttachers: { [embed.metadata!.id]: ADMIN } },
      }),
    );
    clients.set(
      "pcl_foreign",
      create(PlatformClientSchema, {
        metadata: { id: "pcl_foreign", name: "foreign", org: "globex" },
        spec: { vaults: [vaultRef("embed")] },
        status: { vaultAttachers: { [embed.metadata!.id]: ADMIN } },
      }),
    );
    expect(
      await resolve({ run: runOf({ platformClientId: "pcl_dash" }), agentSpec: agent({ A: KEY }) }),
    ).toEqual({ A: "embed" });
    const foreign = await refusal(
      resolve({ run: runOf({ platformClientId: "pcl_foreign" }), agentSpec: agent({ A: KEY }) }),
    );
    expect(foreign.rawMessage).toBe("the agent Helper needs A: list a vault that holds A on the conversation");
  });

  it("uses the person the run recorded, whoever recovers it", async () => {
    await anasVault({ A: "ana-mine" });
    expect(
      await resolve({ run: runOf({ person: ANA }), agentSpec: agent({ A: KEY }) }),
    ).toEqual({ A: "ana-mine" });
    const bens = await refusal(
      resolve({ run: runOf({ person: BEN }), agentSpec: agent({ A: KEY }) }),
    );
    expect(bens.rawMessage).toBe("the agent Helper needs A: add A to My vault");
  });

  it("each sender's turn reads their own My vault, never another's, and both take the conversation's repository token", async () => {
    await anasVault({ B: "ana-mine", GITHUB_TOKEN: "ana-pat" });
    const ben = testCallerIdentity({ identityId: BEN });
    const bens = await rig.vaults.ensureMine(ORG, ben);
    await rig.vaults.setSecrets(bens.metadata!.id, { C: { value: "ben-mine", description: "" } }, ben);
    const turn = {
      session: sessionOf({
        includeMyVault: true,
        repo: { url: "https://github.com/acme/app", token: "repo-own" },
      }),
      agentSpec: agent({ B: { isSecret: true, optional: true }, C: { isSecret: true, optional: true } }),
    };
    expect(await resolve({ run: runOf({ person: ANA }), ...turn })).toEqual({
      B: "ana-mine",
      GITHUB_TOKEN: "repo-own",
    });
    expect(await resolve({ run: runOf({ person: BEN }), ...turn })).toEqual({
      C: "ben-mine",
      GITHUB_TOKEN: "repo-own",
    });
  });

  it("reads the repository tokens and the vault choice from the stored row, not a loader's redacted copy", async () => {
    await anasVault({ A: "ana-mine" });
    const stored = sessionOf({
      includeMyVault: true,
      repo: { url: "https://github.com/acme/app", token: "repo-own" },
    });
    await rig.store.saveResource(ApiResourceKind.session, "ses_resolve", SessionSchema, stored);
    const loaderCopy = sessionOf({
      includeMyVault: false,
      repo: { url: "https://github.com/acme/app", token: REDACTED_MARKER },
    });
    expect(
      await resolve({
        run: runOf({ person: ANA }),
        session: loaderCopy,
        agentSpec: agent({ A: KEY }),
        unsaved: true,
      }),
    ).toEqual({ A: "ana-mine", GITHUB_TOKEN: "repo-own" });
  });

  it("refuses a run whose conversation's stored row is gone, rather than trusting a loader's copy", async () => {
    const failure = await refusal(
      resolve({
        run: runOf({ person: ANA }),
        session: sessionOf({ repo: { url: "https://github.com/acme/app", token: "copied" } }),
        unsaved: true,
      }),
    );
    expect(failure.code).toBe(Code.FailedPrecondition);
    expect(failure.rawMessage).toContain("ses_resolve");
  });

  it("delivers a vault's value only for a declared key", async () => {
    await anasVault({ DECLARED: "from-vault", UNDECLARED_IN_VAULT: "kept-in-vault" });
    const values = await resolve({
      run: runOf({ person: ANA }),
      agentSpec: agent({ DECLARED: KEY }),
    });
    expect(values).toEqual({ DECLARED: "from-vault" });
  });

  it("refuses a conversation's vault its own person may not use, telling them so", async () => {
    await seedSharedVault(rig.store, ORG, "finance", { secrets: { API_KEY: "finance-key" } });
    const failure = await refusal(
      resolve({
        run: runOf({ person: ANA }),
        session: sessionOf({ vaults: ["finance"] }),
        agentSpec: agent({ API_KEY: KEY }),
      }),
    );
    expect(failure.code).toBe(Code.FailedPrecondition);
    expect(failure.rawMessage).toBe(
      "vault 'finance', named by this conversation, is not one you may use: ask a vault admin for its use, or remove it from this conversation",
    );
  });
});

// ---------------------------------------------------------------------------
// Another organization's agent, another organization's surface
// ---------------------------------------------------------------------------

describe("what reaches an agent or a surface of another organization", () => {
  const MAYBE = { isSecret: true, optional: true };
  const elsewhere = (key: string): string =>
    `add ${key} to one of this conversation's vaults: an agent of another organization never reads My vault`;

  it("an agent of another organization gets nothing from the person's My vault, though the conversation includes it, for its own keys or any tool's", async () => {
    await anasVault({ A: "ana-mine", SHARED: "ana-shared", NOTES_KEY: "ana-notes" });
    const values = await resolve({
      run: runOf({ person: ANA }),
      session: sessionOf({ includeMyVault: true }),
      agentSpec: agent({ A: MAYBE, SHARED: MAYBE }),
      agentOrg: "globex",
      tools: [tool("notes", { env: { SHARED: MAYBE, NOTES_KEY: MAYBE } })],
    });
    expect(values).toEqual({});
  });

  it("a tool's login is not filled from My vault for another organization's agent: the run refuses, pointing at the conversation", async () => {
    const mine = await anasVault({ LINEAR_TOKEN: "ana-linear" });
    await rig.vaults.setConnection(
      mine,
      "https://mcp.linear.example/mcp",
      { token: "ana-login", source: VaultConnectionSource.pasted },
      testCallerIdentity({ identityId: ANA }),
    );
    for (const agentOrg of ["globex", null]) {
      const failure = await refusal(
        resolve({
          run: runOf({ person: ANA }),
          agentSpec: agent({}),
          agentOrg,
          tools: [tool("linear", { target: "LINEAR_TOKEN" })],
        }),
      );
      expect(failure.code).toBe(Code.FailedPrecondition);
      expect(failure.rawMessage).toBe(`linear needs LINEAR_TOKEN: ${elsewhere("LINEAR_TOKEN")}`);
    }
  });

  it("a clone for another organization's agent takes no token from My vault, only the repository's own", async () => {
    const mine = await anasVault({ GITHUB_TOKEN: "ana-pat" });
    await rig.vaults.setConnection(
      mine,
      "github.com",
      { token: "ana-gh-login", source: VaultConnectionSource.pasted },
      testCallerIdentity({ identityId: ANA }),
    );
    for (const agentOrg of ["globex", null]) {
      expect(
        await resolve({
          run: runOf({ person: ANA }),
          session: sessionOf({ repo: { url: "https://github.com/acme/app" } }),
          agentSpec: agent({}),
          agentOrg,
        }),
      ).toEqual({});
      expect(
        await resolve({
          run: runOf({ person: ANA }),
          session: sessionOf({ repo: { url: "https://github.com/acme/app", token: "repo-own" } }),
          agentSpec: agent({}),
          agentOrg,
        }),
      ).toEqual({ GITHUB_TOKEN: "repo-own" });
    }
  });

  it("an agent whose row cannot be read counts as another organization's", async () => {
    await anasVault({ A: "ana-mine", NOTES_KEY: "ana-notes" });
    const values = await resolve({
      run: runOf({ person: ANA }),
      agentSpec: agent({ A: MAYBE }),
      agentOrg: null,
      tools: [tool("notes", { env: { NOTES_KEY: MAYBE } })],
    });
    expect(values).toEqual({});
  });

  it("another organization's agent and its tools still take the conversation's listed vaults", async () => {
    await anasVault({ LINEAR_TOKEN: "ana-linear" });
    const team = await seedSharedVault(rig.store, ORG, "team", {
      secrets: { B: "team", LINEAR_TOKEN: "team-linear", GITHUB_TOKEN: "team-pat" },
    });
    mayUse.add(`${ANA}:${team.metadata!.id}`);
    expect(
      await resolve({
        run: runOf({ person: ANA }),
        session: sessionOf({ vaults: ["team"], repo: { url: "https://github.com/acme/app" } }),
        agentSpec: agent({ B: KEY }),
        agentOrg: "globex",
        tools: [tool("linear", { target: "LINEAR_TOKEN" })],
      }),
    ).toEqual({ B: "team", LINEAR_TOKEN: "team-linear", GITHUB_TOKEN: "team-pat" });
  });

  it("a person-less run of another organization's agent still takes its surface's vaults", async () => {
    const team = await seedSharedVault(rig.store, ORG, "channel-keys", { secrets: { A: "chan" } });
    await rig.store.saveResource(
      ApiResourceKind.agent_channel,
      "ach_slack",
      AgentChannelSchema,
      create(AgentChannelSchema, {
        metadata: { id: "ach_slack", name: "slack", org: ORG },
        spec: { vaults: [vaultRef("channel-keys")] },
        status: { vaultAttachers: { [team.metadata!.id]: ADMIN } },
      }),
    );
    mayUse.add(`${ADMIN}:${team.metadata!.id}`);
    expect(
      await resolve({
        run: runOf(),
        session: sessionOf({ labels: { [CHANNEL_ID_LABEL_KEY]: "ach_slack" } }),
        agentSpec: agent({ A: KEY }),
        agentOrg: "globex",
      }),
    ).toEqual({ A: "chan" });
  });

  it("another organization's agent still takes the conversation's vaults, and a missing key says so", async () => {
    await anasVault({ A: "ana-mine" });
    const team = await seedSharedVault(rig.store, ORG, "team", { secrets: { B: "team" } });
    mayUse.add(`${ANA}:${team.metadata!.id}`);
    expect(
      await resolve({
        run: runOf({ person: ANA }),
        session: sessionOf({ vaults: ["team"] }),
        agentSpec: agent({ B: KEY }),
        agentOrg: "globex",
      }),
    ).toEqual({ B: "team" });
    const missing = await refusal(
      resolve({ run: runOf({ person: ANA }), agentSpec: agent({ A: KEY }), agentOrg: "globex" }),
    );
    expect(missing.code).toBe(Code.FailedPrecondition);
    expect(missing.rawMessage).toBe(`the agent Helper needs A: ${elsewhere("A")}`);
  });

  it("a schedule, a share or a channel of another organization contributes no vaults to a run", async () => {
    const team = await seedSharedVault(rig.store, ORG, "team", { secrets: { A: "team" } });
    mayUse.add(`${ADMIN}:${team.metadata!.id}`);
    const attached = { [team.metadata!.id]: ADMIN };
    await rig.store.saveResource(
      ApiResourceKind.schedule,
      "sch_foreign",
      ScheduleSchema,
      create(ScheduleSchema, {
        metadata: { id: "sch_foreign", name: "foreign", org: "globex" },
        spec: { target: { case: "agent", value: { vaults: [vaultRef("team")] } } },
        status: { vaultAttachers: attached },
      }),
    );
    await rig.store.saveResource(
      ApiResourceKind.agent_share,
      "shr_foreign",
      AgentShareSchema,
      create(AgentShareSchema, {
        metadata: { id: "shr_foreign", name: "foreign", org: "globex" },
        spec: { vaults: [vaultRef("team")] },
        status: { vaultAttachers: attached },
      }),
    );
    await rig.store.saveResource(
      ApiResourceKind.agent_channel,
      "ach_foreign",
      AgentChannelSchema,
      create(AgentChannelSchema, {
        metadata: { id: "ach_foreign", name: "foreign", org: "globex" },
        spec: { vaults: [vaultRef("team")] },
        status: { vaultAttachers: attached },
      }),
    );
    const nowhere = "the agent Helper needs A: list a vault that holds A on the conversation";
    for (const labelled of [
      { run: runOf({ labels: { [SCHEDULE_ID_LABEL_KEY]: "sch_foreign" } }) },
      { run: runOf(), session: sessionOf({ labels: { [SHARE_ID_LABEL_KEY]: "shr_foreign" } }) },
      { run: runOf(), session: sessionOf({ labels: { [CHANNEL_ID_LABEL_KEY]: "ach_foreign" } }) },
    ]) {
      const failure = await refusal(resolve({ ...labelled, agentSpec: agent({ A: KEY }) }));
      expect(failure.code).toBe(Code.FailedPrecondition);
      expect(failure.rawMessage).toBe(nowhere);
    }
  });
});

// ---------------------------------------------------------------------------
// Which values are secret
// ---------------------------------------------------------------------------

describe("which values a run receives as secret", () => {
  const PLAIN = { value: "acme-default" };

  /** A key's delivered value and its secret flag, wherever its declarer is. */
  function deliveredAt(values: ExecutionValues, key: string): { value: string; isSecret: boolean } | undefined {
    const value =
      values.agent[key] ?? values.tools.map((tool) => tool.values[key]).find((entry) => entry !== undefined);
    if (value !== undefined) {
      return { value: value.value, isSecret: value.isSecret };
    }
    const repository = key === CLONE_TOKEN_KEY ? values.repositories[0] : undefined;
    return repository === undefined ? undefined : { value: repository.token, isSecret: true };
  }

  it("a plain declaration's own value stays plain; a vault secret filling it is secret", async () => {
    const fromDeclaration = await open({
      run: runOf({ person: ANA }),
      agentSpec: agent({ WORKSPACE: PLAIN }),
    });
    expect(deliveredAt(fromDeclaration, "WORKSPACE")).toEqual({ value: "acme-default", isSecret: false });

    await anasVault({ WORKSPACE: "ana-workspace", BARE: "ana-bare" });
    const fromVault = await open({
      run: runOf({ person: ANA }),
      agentSpec: agent({ WORKSPACE: PLAIN, BARE: {} }),
    });
    expect(deliveredAt(fromVault, "WORKSPACE")).toEqual({ value: "ana-workspace", isSecret: true });
    expect(deliveredAt(fromVault, "BARE")).toEqual({ value: "ana-bare", isSecret: true });
  });

  it("a repository's own token is secret, and so is a listed vault's secret filling a plain declaration", async () => {
    const own = await open({
      run: runOf({ person: ANA }),
      session: sessionOf({ repo: { url: "https://github.com/acme/app", token: "repo-own" } }),
    });
    expect(deliveredAt(own, "GITHUB_TOKEN")).toEqual({ value: "repo-own", isSecret: true });

    const team = await seedSharedVault(rig.store, ORG, "integrator", { secrets: { WORKSPACE: "cust" } });
    mayUse.add(`${ADMIN}:${team.metadata!.id}`);
    const attached = await open({
      run: runOf(),
      session: sessionOf({ vaults: ["integrator"], attachers: { [team.metadata!.id]: ADMIN } }),
      agentSpec: agent({ WORKSPACE: PLAIN }),
    });
    expect(deliveredAt(attached, "WORKSPACE")).toEqual({ value: "cust", isSecret: true });
  });

  it("a connection's token is secret even where the tool declares its login key plain", async () => {
    const mine = await anasVault({});
    await rig.vaults.setConnection(
      mine,
      "https://mcp.linear.example/mcp",
      { token: "by-address", source: VaultConnectionSource.pasted },
      testCallerIdentity({ identityId: ANA }),
    );
    const values = await open({
      run: runOf({ person: ANA }),
      tools: [tool("linear", { target: "LINEAR_TOKEN", env: { LINEAR_TOKEN: { value: "plain-but-a-login" } } })],
    });
    expect(deliveredAt(values, "LINEAR_TOKEN")).toEqual({ value: "by-address", isSecret: true });
  });

  it("the connect lane keeps a plain default plain and marks a My vault value secret", async () => {
    await anasVault({ TEAM: "ana-team" });
    const linear = tool("linear", { env: { TEAM: PLAIN } });
    const bens = await resolver.openConnect({ orgId: ORG, person: BEN, server: linear });
    expect(deliveredAt(bens, "TEAM")).toEqual({ value: "acme-default", isSecret: false });
    const anas = await resolver.openConnect({ orgId: ORG, person: ANA, server: linear });
    expect(deliveredAt(anas, "TEAM")).toEqual({ value: "ana-team", isSecret: true });
  });
});

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

describe("matching", () => {
  it("a login key takes the connection at the tool's address before a secret of its name", async () => {
    const mine = await anasVault({ LINEAR_TOKEN: "by-name" });
    await rig.vaults.setConnection(
      mine,
      "https://mcp.linear.example/mcp",
      { token: "by-address", source: VaultConnectionSource.pasted },
      testCallerIdentity({ identityId: ANA }),
    );
    expect(
      await resolve({
        run: runOf({ person: ANA }),
        tools: [tool("linear", { target: "LINEAR_TOKEN" })],
      }),
    ).toEqual({ LINEAR_TOKEN: "by-address" });
  });

  it("a plain key falls back to its declaration's value, and a vault secret of its name overrides it", async () => {
    const plain = agent({ WORKSPACE: { value: "acme-default" } });
    expect(await resolve({ run: runOf({ person: ANA }), agentSpec: plain })).toEqual({
      WORKSPACE: "acme-default",
    });
    await anasVault({ WORKSPACE: "ana-workspace" });
    expect(await resolve({ run: runOf({ person: ANA }), agentSpec: plain })).toEqual({
      WORKSPACE: "ana-workspace",
    });
  });

  it("an optional key stays absent; a required one refuses naming the tool and the sign-in", async () => {
    expect(
      await resolve({
        run: runOf({ person: ANA }),
        agentSpec: agent({ MAYBE: { isSecret: true, optional: true } }),
      }),
    ).toEqual({});
    const missing = await refusal(
      resolve({ run: runOf({ person: ANA }), tools: [tool("linear", { target: "LINEAR_TOKEN" })] }),
    );
    expect(missing.code).toBe(Code.FailedPrecondition);
    expect(missing.rawMessage).toBe(
      "linear needs LINEAR_TOKEN: sign in to linear, or add LINEAR_TOKEN to My vault",
    );
  });

  it("a clone uses the repository's own token, then a connection for its host", async () => {
    const mine = await anasVault({});
    await rig.vaults.setConnection(
      mine,
      "github.com",
      { token: "gh-login", source: VaultConnectionSource.pasted },
      testCallerIdentity({ identityId: ANA }),
    );
    expect(
      await resolve({
        run: runOf({ person: ANA }),
        session: sessionOf({ repo: { url: "https://github.com/acme/app" } }),
      }),
    ).toEqual({ GITHUB_TOKEN: "gh-login" });
    expect(
      await resolve({
        run: runOf({ person: ANA }),
        session: sessionOf({ repo: { url: "https://github.com/acme/app", token: "repo-own" } }),
      }),
    ).toEqual({ GITHUB_TOKEN: "repo-own" });
  });

  it("a clone from github.com takes a GITHUB_TOKEN secret after its own token and a host connection; another host's does not", async () => {
    const mine = await anasVault({ GITHUB_TOKEN: "pat" });
    expect(
      await resolve({
        run: runOf({ person: ANA }),
        session: sessionOf({ repo: { url: "https://github.com/acme/app" } }),
      }),
    ).toEqual({ GITHUB_TOKEN: "pat" });
    expect(
      await resolve({
        run: runOf({ person: ANA }),
        session: sessionOf({ repo: { url: "https://git.example.com/acme/app" } }),
      }),
    ).toEqual({});
    await rig.vaults.setConnection(
      mine,
      "github.com",
      { token: "gh-login", source: VaultConnectionSource.pasted },
      testCallerIdentity({ identityId: ANA }),
    );
    expect(
      await resolve({
        run: runOf({ person: ANA }),
        session: sessionOf({ repo: { url: "https://github.com/acme/app" } }),
      }),
    ).toEqual({ GITHUB_TOKEN: "gh-login" });
  });

  it("a token for another Git host never fills GITHUB_TOKEN, which the runner sends only to github.com", async () => {
    const mine = await anasVault({});
    await rig.vaults.setConnection(
      mine,
      "git.example.com",
      { token: "other-host-login", source: VaultConnectionSource.pasted },
      testCallerIdentity({ identityId: ANA }),
    );
    expect(
      await resolve({
        run: runOf({ person: ANA }),
        session: sessionOf({ repo: { url: "https://git.example.com/acme/app", token: "other-host-pat" } }),
      }),
      "neither the host's login nor the repository's own token",
    ).toEqual({});

    const github = tool("github", {
      url: "https://api.githubcopilot.com/mcp/",
      env: { GITHUB_TOKEN: { ...KEY, optional: true } },
      headers: { Authorization: "Bearer ${GITHUB_TOKEN}" },
    });
    expect(
      await resolve({
        run: runOf({ person: ANA }),
        session: sessionOf({ repo: { url: "https://git.example.com/acme/app", token: "other-host-pat" } }),
        tools: [github],
      }),
      "nor does it reach the GitHub tool, which found nothing of its own",
    ).toEqual({});
  });

  it("a repository's own token fills only the clone of that repository, not another host's repository of the same name", async () => {
    const repoEntry = (url: string, token: string) => ({
      name: "app",
      source: { source: { case: "gitRepo" as const, value: { url, token } } },
    });
    const twins = create(SessionSchema, {
      metadata: { id: "ses_resolve", org: ORG },
      spec: {
        workspaceEntries: [
          repoEntry("https://gitlab.example.com/acme/app", "gitlab-pat"),
          repoEntry("https://github.com/acme/app", ""),
        ],
      },
    });
    expect(await resolve({ run: runOf({ person: ANA }), session: twins })).toEqual({});
  });

  it("the GitHub tool on GitHub's own API and a clone share the github.com login as GITHUB_TOKEN; with the repository's own token, each takes its own", async () => {
    const github = tool("github", {
      url: "https://api.githubcopilot.com/mcp/",
      env: { GITHUB_TOKEN: KEY },
      headers: { Authorization: "Bearer ${GITHUB_TOKEN}" },
    });
    const mine = await anasVault({});
    await rig.vaults.setConnection(
      mine,
      "github.com",
      { token: "gh-login", source: VaultConnectionSource.pasted },
      testCallerIdentity({ identityId: ANA }),
    );
    const cloning = sessionOf({ repo: { url: "https://github.com/acme/app" } });
    expect(
      await resolve({ run: runOf({ person: ANA }), session: cloning, tools: [github] }),
    ).toEqual({ GITHUB_TOKEN: "gh-login" });

    // Two values for one key once refused the run: each declarer now
    // receives its own, the clone its repository's token and the tool the
    // github.com login.
    const ownToken = sessionOf({ repo: { url: "https://github.com/acme/app", token: "a-different-pat" } });
    const values = await open({ run: runOf({ person: ANA }), session: ownToken, tools: [github] });
    expect(toolValues(values, github)).toEqual({ GITHUB_TOKEN: "gh-login" });
    expect(values.repositories.map((repository) => repository.token)).toEqual(["a-different-pat"]);
  });
});

// ---------------------------------------------------------------------------
// The fetch reads the vaults as they are now
// ---------------------------------------------------------------------------

describe("the fetch opens exactly the planned entries, as they are now", () => {
  const ana = testCallerIdentity({ identityId: ANA });

  it("records where each value lives, never the value", async () => {
    const mine = await anasVault({ API_KEY: "ana-key" });
    const sources = await plan({ run: runOf({ person: ANA }), agentSpec: agent({ API_KEY: KEY }) });
    expect(sources.map((entry) => [entry.key, entry.vaultId, entry.entry, entry.login])).toEqual([
      ["API_KEY", mine, "API_KEY", false],
    ]);
    expect(JSON.stringify(sources)).not.toContain("ana-key");
  });

  it("picks up a secret rotated after the plan", async () => {
    const mine = await anasVault({ API_KEY: "before" });
    const values = await open({ run: runOf({ person: ANA }), agentSpec: agent({ API_KEY: KEY }) }, async () => {
      await rig.vaults.setSecrets(mine, { API_KEY: { value: "rotated", description: "" } }, ana);
    });
    expect(agentValues(values)).toEqual({ API_KEY: "rotated" });
  });

  it("refuses an entry removed after the plan, naming the key, its declarer and the vault, and saying to recover", async () => {
    const mine = await anasVault({ API_KEY: "before" });
    const failure = await refusal(
      open({ run: runOf({ person: ANA }), agentSpec: agent({ API_KEY: KEY }) }, async () => {
        await rig.vaults.removeSecrets(mine, ["API_KEY"], ana);
      }),
    );
    expect(failure.code).toBe(Code.FailedPrecondition);
    expect(failure.rawMessage).toBe(
      "the agent Helper needs API_KEY, but My vault no longer holds a secret named API_KEY. Fix it, then recover the turn",
    );
  });

  it("refuses a shared vault whose use was revoked after the plan, naming it", async () => {
    const team = await seedSharedVault(rig.store, ORG, "team", { secrets: { API_KEY: "team-key" } });
    mayUse.add(`${ANA}:${team.metadata!.id}`);
    const failure = await refusal(
      open(
        { run: runOf({ person: ANA }), session: sessionOf({ vaults: ["team"] }), agentSpec: agent({ API_KEY: KEY }) },
        async () => {
          mayUse.delete(`${ANA}:${team.metadata!.id}`);
        },
      ),
    );
    expect(failure.code).toBe(Code.FailedPrecondition);
    expect(failure.rawMessage).toContain("the agent Helper needs API_KEY, but vault 'team'");
    expect(failure.rawMessage).toContain("is not one you may use");
  });

  it("refuses a vault the conversation no longer lists", async () => {
    const team = await seedSharedVault(rig.store, ORG, "team", { secrets: { API_KEY: "team-key" } });
    mayUse.add(`${ANA}:${team.metadata!.id}`);
    const failure = await refusal(
      open(
        { run: runOf({ person: ANA }), session: sessionOf({ vaults: ["team"] }), agentSpec: agent({ API_KEY: KEY }) },
        async () => {
          await stored(sessionOf({ vaults: [] }));
        },
      ),
    );
    expect(failure.code).toBe(Code.FailedPrecondition);
    expect(failure.rawMessage).toContain(`vault ${team.metadata!.id} is no longer one this conversation uses`);
  });

  it("refuses My vault once the conversation stops including it", async () => {
    await anasVault({ API_KEY: "ana-key" });
    const failure = await refusal(
      open({ run: runOf({ person: ANA }), agentSpec: agent({ API_KEY: KEY }) }, async () => {
        await stored(sessionOf({ includeMyVault: false }));
      }),
    );
    expect(failure.code).toBe(Code.FailedPrecondition);
    expect(failure.rawMessage).toContain("this conversation no longer includes My vault");
  });

  it("refuses a tool's login once the tool moved to another address: the login never follows it", async () => {
    const mine = await anasVault({});
    await rig.vaults.setConnection(
      mine,
      "https://mcp.linear.example/mcp",
      { token: "linear-login", source: VaultConnectionSource.pasted },
      ana,
    );
    const linear = tool("linear", { target: "LINEAR_TOKEN" });
    const failure = await refusal(
      open({ run: runOf({ person: ANA }), tools: [linear] }, async () => {
        const moved = tool("linear", { url: "https://evil.example/mcp", target: "LINEAR_TOKEN" });
        await rig.store.saveResource(ApiResourceKind.mcp_server, moved.metadata!.id, McpServerSchema, moved);
      }),
    );
    expect(failure.code).toBe(Code.FailedPrecondition);
    expect(failure.rawMessage).toContain(
      "linear needs LINEAR_TOKEN, but the tool is no longer at https://mcp.linear.example/mcp",
    );
    expect(failure.rawMessage).not.toContain("linear-login");
  });

  it("answers each HTTP tool's URL as the fetch read it, and none for a local program", async () => {
    await anasVault({ LINEAR_TOKEN: "lin", PROGRAM_KEY: "prog" });
    const linear = tool("linear", { target: "LINEAR_TOKEN" });
    const program = localTool("program", { target: "PROGRAM_KEY" });
    const values = await open({ run: runOf({ person: ANA }), tools: [linear, program] });
    expect(values.tools.map((group) => [group.mcpServerId, group.url])).toEqual([
      ["mcp_linear", "https://mcp.linear.example/mcp"],
      ["mcp_program", ""],
    ]);
  });
});

// ---------------------------------------------------------------------------
// Sign-ins
// ---------------------------------------------------------------------------

describe("sign-ins", () => {
  async function signedIn(): Promise<string> {
    const mine = await anasVault({});
    await rig.vaults.setConnection(
      mine,
      "https://mcp.linear.example/mcp",
      {
        token: "old",
        source: VaultConnectionSource.sign_in,
        signIn: {
          expiresAt: 1n,
          clientId: "c",
          authMethod: "mcp_oauth",
          tokenEndpoint: "https://linear.example/token",
          refreshToken: "r",
          loginApp: "",
        },
      },
      testCallerIdentity({ identityId: ANA }),
    );
    return mine;
  }

  it("are freshened once per connection per run, even when the tool is used twice", async () => {
    const mine = await signedIn();
    const values = await resolve({
      run: runOf({ person: ANA }),
      tools: [tool("linear", { target: "LINEAR_TOKEN" }), tool("linear", { target: "LINEAR_TOKEN" })],
    });
    expect(values).toEqual({ LINEAR_TOKEN: "fresh-old" });
    expect(freshened).toEqual([`${mine}|https://mcp.linear.example/mcp`]);
  });

  it("fill every HTTP tool at their address, renewed once, and no tool at another", async () => {
    const mine = await signedIn();
    const second = tool("second", { url: "https://mcp.linear.example/mcp", target: "LINEAR_API_KEY" });
    expect(
      await resolve({ run: runOf({ person: ANA }), tools: [tool("linear", { target: "LINEAR_TOKEN" }), second] }),
    ).toEqual({ LINEAR_TOKEN: "fresh-old", LINEAR_API_KEY: "fresh-old" });
    expect(freshened).toEqual([`${mine}|https://mcp.linear.example/mcp`]);

    freshened = [];
    const elsewhere = tool("elsewhere", { url: "https://mcp.linear.example/other", target: "LINEAR_TOKEN" });
    const failure = await refusal(resolve({ run: runOf({ person: ANA }), tools: [elsewhere] }));
    expect(failure.code).toBe(Code.FailedPrecondition);
    expect(failure.rawMessage).toContain("elsewhere needs LINEAR_TOKEN");
    expect(freshened).toEqual([]);
  });

  it("never reach a local program: it has no address, and takes its key as a secret by name", async () => {
    const mine = await signedIn();
    await rig.vaults.setConnection(
      mine,
      "https://mcp.notion.example/mcp",
      { token: "notion-pasted", source: VaultConnectionSource.pasted },
      testCallerIdentity({ identityId: ANA }),
    );
    for (const program of [
      localTool("program", { target: "LINEAR_TOKEN" }),
      localTool("program", { target: "NOTION_KEY" }),
    ]) {
      const failure = await refusal(resolve({ run: runOf({ person: ANA }), tools: [program] }));
      expect(failure.code).toBe(Code.FailedPrecondition);
      expect(failure.rawMessage).toContain("program needs");
    }
    expect(freshened).toEqual([]);

    await rig.vaults.setSecrets(
      mine,
      { LINEAR_TOKEN: { value: "lin-secret", description: "" } },
      testCallerIdentity({ identityId: ANA }),
    );
    expect(
      await resolve({ run: runOf({ person: ANA }), tools: [localTool("program", { target: "LINEAR_TOKEN" })] }),
    ).toEqual({ LINEAR_TOKEN: "lin-secret" });
  });

  it("planning renews nothing, whatever the plan finds: only the fetch renews", async () => {
    await signedIn();
    const failure = await refusal(
      plan({
        run: runOf({ person: ANA }),
        agentSpec: agent({ MISSING: KEY }),
        tools: [tool("linear", { target: "LINEAR_TOKEN" })],
      }),
    );
    expect(failure.code).toBe(Code.FailedPrecondition);
    expect(failure.rawMessage).toContain("needs MISSING");
    await plan({ run: runOf({ person: ANA }), tools: [tool("linear", { target: "LINEAR_TOKEN" })] });
    expect(freshened).toEqual([]);
  });

  it("a renewal at the fetch is written back in the run's person's name, as the server acting for them, never the runner's", async () => {
    await signedIn();
    await open({ run: runOf({ person: ANA }), tools: [tool("linear", { target: "LINEAR_TOKEN" })] });
    expect(renewedAs.map((caller) => [caller.identityId, caller.callerClass])).toEqual([
      [ANA, "internal"],
    ]);
  });

  it("the agent's own declaration of the tool's login key reaches the agent nothing: the tool alone takes the sign-in", async () => {
    const mine = await signedIn();
    await rig.vaults.setSecrets(
      mine,
      { LINEAR_TOKEN: { value: "by-name", description: "" } },
      testCallerIdentity({ identityId: ANA }),
    );
    const linear = tool("linear", { target: "LINEAR_TOKEN" });
    const values = await open({
      run: runOf({ person: ANA }),
      agentSpec: agent({ LINEAR_TOKEN: KEY }),
      tools: [linear],
    });
    expect(toolValues(values, linear)).toEqual({ LINEAR_TOKEN: "fresh-old" });
    expect(agentValues(values)).toEqual({});
  });

  it("a fault while renewing is INTERNAL, and its text is not handed to the caller", async () => {
    await signedIn();
    const faulty = resolverWith({
      freshener: {
        freshToken: async () => {
          throw new Error("disk gone at /var/lib/stigmer");
        },
      },
    });
    const failure = await refusal(
      open({ run: runOf({ person: ANA }), tools: [tool("linear", { target: "LINEAR_TOKEN" })] }, undefined, faulty),
    );
    expect(failure.code).toBe(Code.Internal);
    expect(failure.rawMessage).not.toContain("disk gone");
  });

  it("a failed renewal refuses the run, telling the person to sign in again", async () => {
    await signedIn();
    freshenFails = true;
    const failure = await refusal(
      resolve({ run: runOf({ person: ANA }), tools: [tool("linear", { target: "LINEAR_TOKEN" })] }),
    );
    expect(failure.code).toBe(Code.FailedPrecondition);
    expect(failure.rawMessage).toContain(
      "the sign-in for https://mcp.linear.example/mcp in My vault could not be renewed",
    );
    expect(failure.rawMessage).toContain("Sign in again");
  });
});

// ---------------------------------------------------------------------------
// Per declarer
// ---------------------------------------------------------------------------

describe("a value reaches only its own declarer", () => {
  const LINEAR_URL = "https://mcp.linear.example/mcp";

  /** Ana's My vault with a Linear sign-in at LINEAR_URL; answers its id. */
  async function linearSignIn(): Promise<string> {
    const mine = await anasVault({});
    await rig.vaults.setConnection(
      mine,
      LINEAR_URL,
      {
        token: "linear-login",
        source: VaultConnectionSource.sign_in,
        signIn: {
          expiresAt: 1n,
          clientId: "c",
          authMethod: "mcp_oauth",
          tokenEndpoint: "https://linear.example/token",
          refreshToken: "r",
          loginApp: "",
        },
      },
      testCallerIdentity({ identityId: ANA }),
    );
    return mine;
  }

  /** Ana's My vault with a pasted github.com login; answers its id. */
  async function githubLogin(): Promise<string> {
    const mine = await anasVault({});
    await rig.vaults.setConnection(
      mine,
      "github.com",
      { token: "gh-login", source: VaultConnectionSource.pasted },
      testCallerIdentity({ identityId: ANA }),
    );
    return mine;
  }

  const cloning = (): Session => sessionOf({ repo: { url: "https://github.com/acme/app" } });
  const OPTIONAL = { isSecret: true, optional: true };

  it("never hands a sign-in's token to another tool that declares its key: that tool is refused as missing it, naming it, and nothing renews", async () => {
    await linearSignIn();
    const evil = tool("evil", {
      url: "https://evil.example/mcp",
      env: { LINEAR_TOKEN: KEY },
      headers: { Authorization: "Bearer ${LINEAR_TOKEN}" },
    });
    const failure = await refusal(
      plan({
        run: runOf({ person: ANA }),
        tools: [tool("linear", { url: LINEAR_URL, target: "LINEAR_TOKEN" }), evil],
      }),
    );
    expect(failure.code).toBe(Code.FailedPrecondition);
    expect(failure.rawMessage).toContain("evil needs LINEAR_TOKEN");
    expect(failure.rawMessage).not.toContain("linear-login");
    expect(freshened).toEqual([]);
  });

  it("gives the tool its login and another tool at another URL nothing, a pasted login and a sign-in alike", async () => {
    const mine = await anasVault({});
    await rig.vaults.setConnection(
      mine,
      LINEAR_URL,
      { token: "pasted-linear", source: VaultConnectionSource.pasted },
      testCallerIdentity({ identityId: ANA }),
    );
    const linear = tool("linear", { url: LINEAR_URL, target: "LINEAR_TOKEN" });
    for (const other of [
      tool("notes", { url: "https://mcp.linear.example/mcp/v2", env: { LINEAR_TOKEN: OPTIONAL } }),
      tool("notes", { url: "https://mcp.notes.example/mcp", env: { LINEAR_TOKEN: OPTIONAL } }),
    ]) {
      const values = await open({ run: runOf({ person: ANA }), tools: [linear, other] });
      expect(toolValues(values, linear)).toEqual({ LINEAR_TOKEN: "pasted-linear" });
      expect(toolValues(values, other)).toEqual({});
    }
  });

  it("gives two declarers of one key their own values: the clone the github.com login, the agent its GITHUB_TOKEN secret", async () => {
    const mine = await githubLogin();
    await rig.vaults.setSecrets(
      mine,
      { GITHUB_TOKEN: { value: "agents-own-pat", description: "" } },
      testCallerIdentity({ identityId: ANA }),
    );
    const values = await open({
      run: runOf({ person: ANA }),
      session: cloning(),
      agentSpec: agent({ GITHUB_TOKEN: KEY }),
    });
    expect(values.repositories.map((repository) => [repository.name, repository.token])).toEqual([
      ["app", "gh-login"],
    ]);
    expect(agentValues(values)).toEqual({ GITHUB_TOKEN: "agents-own-pat" });
  });

  it("never plans the github.com login for the agent's own GITHUB_TOKEN beside a clone: the shell takes secrets by name only", async () => {
    await githubLogin();
    const failure = await refusal(
      plan({ run: runOf({ person: ANA }), session: cloning(), agentSpec: agent({ GITHUB_TOKEN: KEY }) }),
    );
    expect(failure.code).toBe(Code.FailedPrecondition);
    expect(failure.rawMessage).toContain("the agent Helper needs GITHUB_TOKEN");

    const values = await open({
      run: runOf({ person: ANA }),
      session: cloning(),
      agentSpec: agent({ GITHUB_TOKEN: OPTIONAL }),
    });
    expect(agentValues(values)).toEqual({});
    expect(values.repositories[0]?.token).toBe("gh-login");
  });

  it("lets the clone and a GitHub tool on GitHub's own API share the github.com login, and the agent declaring the key gets none of it", async () => {
    await githubLogin();
    for (const url of ["https://api.githubcopilot.com/mcp/", "https://api.github.com/mcp"]) {
      const github = tool("github", {
        url,
        env: { GITHUB_TOKEN: KEY },
        headers: { Authorization: "Bearer ${GITHUB_TOKEN}" },
      });
      const values = await open({
        run: runOf({ person: ANA }),
        session: cloning(),
        agentSpec: agent({ GITHUB_TOKEN: KEY }),
        tools: [github],
      });
      expect(toolValues(values, github)).toEqual({ GITHUB_TOKEN: "gh-login" });
      expect(values.repositories[0]?.token).toBe("gh-login");
      expect(agentValues(values), url).toEqual({});
    }
  });

  it("never hands the github.com login to a tool at another host that declares GITHUB_TOKEN", async () => {
    await githubLogin();
    for (const url of [
      "https://mcp.other.example/mcp",
      "https://api.github.com.evil.example/mcp",
      "http://api.github.com/mcp",
    ]) {
      const other = tool("other", { url, env: { GITHUB_TOKEN: OPTIONAL } });
      const values = await open({ run: runOf({ person: ANA }), session: cloning(), tools: [other] });
      expect(toolValues(values, other), url).toEqual({});
      expect(values.repositories[0]?.token).toBe("gh-login");
    }
  });

  it("hands a repository's own token to its clone alone: never a GitHub tool, never the agent", async () => {
    const owned = (): Session =>
      sessionOf({ repo: { url: "https://github.com/acme/app", token: "repo-own" } });
    const github = tool("github", {
      url: "https://api.githubcopilot.com/mcp/",
      headers: { Authorization: "Bearer ${GITHUB_TOKEN}" },
    });
    const failure = await refusal(
      plan({ run: runOf({ person: ANA }), session: owned(), tools: [github] }),
    );
    expect(failure.code).toBe(Code.FailedPrecondition);
    expect(failure.rawMessage).toContain("github needs GITHUB_TOKEN");
    expect(failure.rawMessage).not.toContain("repo-own");

    const values = await open({
      run: runOf({ person: ANA }),
      session: owned(),
      agentSpec: agent({ GITHUB_TOKEN: OPTIONAL }),
    });
    expect(values.repositories.map((repository) => repository.token)).toEqual(["repo-own"]);
    expect(agentValues(values)).toEqual({});
  });

  it("fills a GitHub tool on GitHub's own API from the github.com login with no repository in the run, after the tool's own login and before a secret by name", async () => {
    const mine = await githubLogin();
    const githubAt = (url: string): McpServer =>
      tool("github", {
        url,
        env: { GITHUB_TOKEN: KEY },
        headers: { Authorization: "Bearer ${GITHUB_TOKEN}" },
      });
    for (const url of ["https://api.githubcopilot.com/mcp/", "https://api.github.com/mcp"]) {
      expect(
        await resolve({ run: runOf({ person: ANA }), tools: [githubAt(url)] }),
      ).toEqual({ GITHUB_TOKEN: "gh-login" });
    }

    await rig.vaults.setSecrets(
      mine,
      { GITHUB_TOKEN: { value: "by-name", description: "" } },
      testCallerIdentity({ identityId: ANA }),
    );
    expect(
      await resolve({ run: runOf({ person: ANA }), tools: [githubAt("https://api.github.com/mcp")] }),
      "the github.com login comes before a secret by name",
    ).toEqual({ GITHUB_TOKEN: "gh-login" });

    await rig.vaults.setConnection(
      mine,
      "https://api.github.com/mcp",
      { token: "tool-own-login", source: VaultConnectionSource.pasted },
      testCallerIdentity({ identityId: ANA }),
    );
    expect(
      await resolve({ run: runOf({ person: ANA }), tools: [githubAt("https://api.github.com/mcp")] }),
      "the tool's own login comes first",
    ).toEqual({ GITHUB_TOKEN: "tool-own-login" });
  });

  it("never fills a tool off GitHub's own API, or a local program naming it, from the github.com login", async () => {
    await githubLogin();
    for (const other of [
      tool("other", {
        url: "https://api.github.com.evil.example/mcp",
        env: { GITHUB_TOKEN: KEY },
        headers: { Authorization: "Bearer ${GITHUB_TOKEN}" },
      }),
      tool("other", {
        url: "http://api.github.com/mcp",
        env: { GITHUB_TOKEN: KEY },
        headers: { Authorization: "Bearer ${GITHUB_TOKEN}" },
      }),
      tool("other", {
        url: "https://api.github.com:8443/mcp",
        env: { GITHUB_TOKEN: KEY },
        headers: { Authorization: "Bearer ${GITHUB_TOKEN}" },
      }),
      localTool("other", { target: "GITHUB_TOKEN" }),
    ]) {
      const failure = await refusal(plan({ run: runOf({ person: ANA }), tools: [other] }));
      expect(failure.code).toBe(Code.FailedPrecondition);
      expect(failure.rawMessage).toContain("other needs GITHUB_TOKEN");
    }
  });

  it("never plans a key a tool of the run declares for the agent, though agent save copied it there: its env or its login alike", async () => {
    await linearSignIn();
    for (const linear of [
      tool("linear", { url: LINEAR_URL, env: { LINEAR_TOKEN: KEY }, target: "LINEAR_TOKEN" }),
      // A login key only a header names is the tool's key too.
      tool("linear", { url: LINEAR_URL, headers: { Authorization: "Bearer ${LINEAR_TOKEN}" } }),
    ]) {
      const sources = await plan({
        run: runOf({ person: ANA }),
        agentSpec: agent({ LINEAR_TOKEN: KEY }),
        tools: [linear],
      });
      expect(sources.map((entry) => entry.declarer?.name)).toEqual(["linear"]);
      const values = await open({
        run: runOf({ person: ANA }),
        agentSpec: agent({ LINEAR_TOKEN: KEY }),
        tools: [linear],
      });
      expect(toolValues(values, linear)).toEqual({ LINEAR_TOKEN: "fresh-linear-login" });
      expect(agentValues(values)).toEqual({});
    }
  });

  it("keeps the agent's key from a tool's whose server the runner later skips: the plan alone decides", async () => {
    await anasVault({ NOTION_KEY: "notion-secret" });
    const notion = tool("notion", { env: { NOTION_KEY: KEY } });
    // The tool's row is gone by the time the runner loads it; its key
    // still never reaches the agent.
    const values = await open(
      { run: runOf({ person: ANA }), agentSpec: agent({ NOTION_KEY: KEY }), tools: [notion] },
      async () => {
        await rig.store.deleteResource(ApiResourceKind.mcp_server, notion.metadata!.id);
      },
    );
    expect(agentValues(values)).toEqual({});
  });

  it("gives a clone nothing from another tool's sign-in: only the github.com login is for github.com", async () => {
    const mine = await anasVault({});
    await rig.vaults.setConnection(
      mine,
      "https://mcp.gh-proxy.example/mcp",
      {
        token: "proxy-login",
        source: VaultConnectionSource.sign_in,
        signIn: {
          expiresAt: 1n,
          clientId: "c",
          authMethod: "mcp_oauth",
          tokenEndpoint: "https://gh-proxy.example/token",
          refreshToken: "r",
          loginApp: "",
        },
      },
      testCallerIdentity({ identityId: ANA }),
    );
    const proxy = tool("proxy", { url: "https://mcp.gh-proxy.example/mcp", target: "GITHUB_TOKEN" });
    const values = await open({ run: runOf({ person: ANA }), session: cloning(), tools: [proxy] });
    expect(toolValues(values, proxy)).toEqual({ GITHUB_TOKEN: "fresh-proxy-login" });
    expect(values.repositories).toEqual([]);
  });

  it("serves a secret by name to every tool that declares its key", async () => {
    await anasVault({ LINEAR_TOKEN: "linear-pat" });
    const linear = tool("linear", { url: LINEAR_URL, target: "LINEAR_TOKEN" });
    const other = tool("other", {
      url: "https://other.example/mcp",
      headers: { Authorization: "Bearer ${LINEAR_TOKEN}" },
    });
    const values = await open({ run: runOf({ person: ANA }), tools: [linear, other] });
    expect(toolValues(values, linear)).toEqual({ LINEAR_TOKEN: "linear-pat" });
    expect(toolValues(values, other)).toEqual({ LINEAR_TOKEN: "linear-pat" });
  });
});

// ---------------------------------------------------------------------------
// The connect lane
// ---------------------------------------------------------------------------

describe("the connect lane", () => {
  const linear = tool("linear", { target: "LINEAR_TOKEN", env: { TEAM: { value: "core" } } });

  it("a person's connect reads their My vault, and its plain defaults", async () => {
    await anasVault({ LINEAR_TOKEN: "ana-token" });
    const values = await resolver.openConnect({ orgId: ORG, person: ANA, server: linear });
    expect(toolValues(values, linear)).toEqual({ LINEAR_TOKEN: "ana-token", TEAM: "core" });
    expect(values.agent).toEqual({});
  });

  it("a teammate's connect reads the teammate's My vault, never Ana's", async () => {
    await anasVault({ LINEAR_TOKEN: "ana-token" });
    const failure = await refusal(resolver.openConnect({ orgId: ORG, person: BEN, server: linear }));
    expect(failure.code).toBe(Code.FailedPrecondition);
    expect(failure.rawMessage).toContain("linear needs LINEAR_TOKEN");
  });

  it("a caller who is no person reads no My vault", async () => {
    await anasVault({ LINEAR_TOKEN: "ana-token" });
    const failure = await refusal(resolver.planConnect({ orgId: ORG, person: undefined, server: linear }));
    expect(failure.code).toBe(Code.FailedPrecondition);
  });

  it("a sign-in saved into a shared vault never serves a connect", async () => {
    const team = await seedSharedVault(rig.store, ORG, "team", { secrets: { LINEAR_TOKEN: "team-token" } });
    mayUse.add(`${ANA}:${team.metadata!.id}`);
    const failure = await refusal(resolver.planConnect({ orgId: ORG, person: ANA, server: linear }));
    expect(failure.code).toBe(Code.FailedPrecondition);
  });
});

// ---------------------------------------------------------------------------
// Edges
// ---------------------------------------------------------------------------

function resolverWith(overrides: {
  authorizer?: Authorizer;
  freshener?: SignInFreshener;
  getResource?: () => Promise<never>;
}): VaultResolver {
  const store =
    overrides.getResource === undefined
      ? rig.store
      : new Proxy(rig.store, {
          get(target, prop, receiver) {
            if (prop === "getResource") {
              return overrides.getResource;
            }
            const value = Reflect.get(target, prop, receiver) as unknown;
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
  return newVaultResolver({
    store,
    logger: silentLogger,
    authorizer: overrides.authorizer ?? useTable,
    secretService: rig.secrets,
    vaults: rig.vaults,
    platformClients: { findById: async () => undefined },
    freshener: overrides.freshener ?? freshener,
  });
}

describe("edges", () => {
  it("reads the login key from the Authorization header among others, and none without one", () => {
    expect(
      loginKeyOf(tool("x", { headers: { "X-Trace": "1", authorization: "Bearer ${X_KEY}" } })),
    ).toBe("X_KEY");
    expect(loginKeyOf(tool("y", { headers: { "X-Trace": "1" } }))).toBeUndefined();
  });

  it("a local folder needs no clone token", () => {
    const requirements = runRequirements({
      execution: runOf(),
      session: create(SessionSchema, {
        spec: {
          workspaceEntries: [
            { name: "folder", source: { source: { case: "localPath", value: { path: "/w" } } } },
          ],
        },
      }),
      agentSpec: undefined,
      agentName: "",
      agentOrg: undefined,
      tools: [],
    });
    expect(requirements).toEqual([]);
  });

  it("reads a vault the conversation lists twice once", async () => {
    const team = await seedSharedVault(rig.store, ORG, "team", { secrets: { API_KEY: "team-key" } });
    mayUse.add(`${ANA}:${team.metadata!.id}`);
    const values = await resolve({
      run: runOf({ person: ANA }),
      session: sessionOf({ vaults: ["team", "team"] }),
      agentSpec: agent({ API_KEY: KEY }),
    });
    expect(values).toEqual({ API_KEY: "team-key" });
  });

  it("someone else's My vault named by the conversation refuses", async () => {
    const ben = testCallerIdentity({ identityId: BEN });
    const bens = await rig.vaults.ensureMine(ORG, ben);
    await rig.vaults.setSecrets(bens.metadata!.id, { API_KEY: { value: "ben-key", description: "" } }, ben);
    const slug = bens.metadata!.slug;

    const refused = await refusal(
      resolve({
        run: runOf({ person: ANA }),
        session: sessionOf({ vaults: [slug] }),
        agentSpec: agent({ API_KEY: KEY }),
      }),
    );
    expect(refused.code).toBe(Code.FailedPrecondition);
    expect(refused.rawMessage).toContain("someone's own My vault");
  });

  it("a person-less run asks the account that attached the conversation's vault", async () => {
    const team = await seedSharedVault(rig.store, ORG, "integrator", { secrets: { API_KEY: "cust-key" } });
    mayUse.add(`${ADMIN}:${team.metadata!.id}`);
    const values = await resolve({
      run: runOf(),
      session: sessionOf({ vaults: ["integrator"], attachers: { [team.metadata!.id]: ADMIN } }),
      agentSpec: agent({ API_KEY: KEY }),
    });
    expect(values).toEqual({ API_KEY: "cust-key" });
  });

  it("an authorization outage is a failure, never a refusal or an admission", async () => {
    await seedSharedVault(rig.store, ORG, "team", { secrets: { API_KEY: "team-key" } });
    const outage = resolverWith({
      authorizer: { authorize: async () => ({ kind: "unavailable", cause: new Error("fga down") }) },
    });
    await expect(
      plan(
        { run: runOf({ person: ANA }), session: sessionOf({ vaults: ["team"] }), agentSpec: agent({ API_KEY: KEY }) },
        outage,
      ),
    ).rejects.toThrow("fga down");
  });

  it("a store fault reading the conversation propagates", async () => {
    await expect(
      plan(
        { run: runOf({ person: ANA }), unsaved: true },
        resolverWith({
          getResource: async () => {
            throw new Error("disk gone");
          },
        }),
      ),
    ).rejects.toThrow("disk gone");
  });

  it("a store fault reading a run's surface propagates", async () => {
    const faulting = new Proxy(rig.store, {
      get(target, prop, receiver) {
        if (prop === "getResource") {
          return async (...args: Parameters<typeof rig.store.getResource>) => {
            if (args[0] === ApiResourceKind.schedule) {
              throw new Error("disk gone");
            }
            return rig.store.getResource(...args);
          };
        }
        const value = Reflect.get(target, prop, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const faulty = newVaultResolver({
      store: faulting,
      logger: silentLogger,
      authorizer: useTable,
      secretService: rig.secrets,
      vaults: rig.vaults,
      platformClients: { findById: async () => undefined },
      freshener,
    });
    await expect(
      plan({ run: runOf({ labels: { [SCHEDULE_ID_LABEL_KEY]: "sch_any" } }) }, faulty),
    ).rejects.toThrow("disk gone");
  });

  it("the sign-in slice's own freshener refuses a sign-in it cannot renew as a precondition, not a fault", async () => {
    const mine = await rig.vaults.ensureMine(ORG, testCallerIdentity({ identityId: ANA }));
    await rig.vaults.setConnection(
      mine.metadata!.id,
      "https://mcp.linear.example/mcp",
      {
        token: "old",
        source: VaultConnectionSource.sign_in,
        signIn: {
          expiresAt: 1n,
          clientId: "c",
          authMethod: "mcp_oauth",
          tokenEndpoint: "https://auth.example/token",
          refreshToken: "",
          loginApp: "",
        },
      },
      testCallerIdentity({ identityId: ANA }),
    );
    const real = resolverWith({
      freshener: newSignInFreshener({
        loginProviders: new Map(),
        vaults: rig.vaults,
        store: rig.store,
        secretService: rig.secrets,
        logger: silentLogger,
      }),
    });
    const failure = await refusal(
      open({ run: runOf({ person: ANA }), tools: [tool("linear", { target: "LINEAR_TOKEN" })] }, undefined, real),
    );
    expect(failure.code).toBe(Code.FailedPrecondition);
    expect(failure.rawMessage).toBe(
      "the sign-in for https://mcp.linear.example/mcp in My vault could not be renewed: " +
        "it has expired and no refresh token is available. Sign in again, then recover the turn",
    );
  });

  it("a renewal refused with a status passes that status through", async () => {
    const mine = await rig.vaults.ensureMine(ORG, testCallerIdentity({ identityId: ANA }));
    await rig.vaults.setConnection(
      mine.metadata!.id,
      "https://mcp.linear.example/mcp",
      {
        token: "old",
        source: VaultConnectionSource.sign_in,
        signIn: {
          expiresAt: 1n,
          clientId: "c",
          authMethod: "mcp_oauth",
          tokenEndpoint: "https://auth.example/token",
          refreshToken: "r",
          loginApp: "",
        },
      },
      testCallerIdentity({ identityId: ANA }),
    );
    const refusing = resolverWith({
      freshener: {
        freshToken: async () => {
          throw new ConnectError("sign in again", Code.Unauthenticated);
        },
      },
    });
    const failure = await refusal(
      open({ run: runOf({ person: ANA }), tools: [tool("linear", { target: "LINEAR_TOKEN" })] }, undefined, refusing),
    );
    expect(failure.code).toBe(Code.Unauthenticated);
  });
});

// ---------------------------------------------------------------------------
// A stored value the server cannot open
// ---------------------------------------------------------------------------

describe("a stored value the server cannot open", () => {
  /** A value sealed under a key, and a facade that cannot open it, with the error it answers. */
  interface Unopenable {
    readonly secrets: SecretService;
    readonly stored: string;
    readonly error: typeof EncryptionDisabledError | typeof DecryptionFailedError;
    readonly message: string;
  }

  const SEALED_PLAINTEXT = "the-real-value";

  async function unopenable(how: "no key configured" | "tampered"): Promise<Unopenable> {
    const key = randomBytes(32);
    const sealed = await SecretService.create(key).encrypt(
      SEALED_PLAINTEXT,
      EncryptionScope.forOrganization(ORG),
    );
    if (how === "no key configured") {
      return {
        secrets: SecretService.create(undefined),
        stored: sealed,
        error: EncryptionDisabledError,
        message: "encryption is not enabled - no key configured",
      };
    }
    const bytes = Buffer.from(sealed.slice(ENCRYPTED_PREFIX.length), "base64");
    bytes.writeUInt8(bytes.readUInt8(GCM_NONCE_SIZE) ^ 0xff, GCM_NONCE_SIZE);
    return {
      secrets: SecretService.create(key),
      stored: `${ENCRYPTED_PREFIX}${bytes.toString("base64")}`,
      error: DecryptionFailedError,
      message: "decryption failed - wrong key or tampered data",
    };
  }

  /** A resolver whose vault service and session values open through `secrets`. */
  function resolverOver(secrets: SecretService): VaultResolver {
    return newVaultResolver({
      store: rig.store,
      logger: silentLogger,
      authorizer: useTable,
      secretService: secrets,
      vaults: newVaultService({
        store: rig.store,
        logger: silentLogger,
        secretService: secrets,
        authorizationLifecycle: undefined,
      }),
      platformClients: { findById: async () => undefined },
      freshener,
    });
  }

  /** The fetch's failure; a fetch that opens fails the test, naming what it carried. */
  async function failureOfFetch(fetched: Promise<ExecutionValues>): Promise<Error> {
    let values: ExecutionValues;
    try {
      values = await fetched;
    } catch (error) {
      if (error instanceof Error) {
        return error;
      }
      throw error;
    }
    throw new Error(`expected the fetch refused; it carried ${JSON.stringify(flatten(values))}`);
  }

  it.each(["no key configured", "tampered"] as const)(
    "a vault's secret (%s) is planned without opening it, then refuses the fetch, and no value reaches it",
    async (how) => {
      const cannot = await unopenable(how);
      const team = await seedSharedVault(rig.store, ORG, "sealed", {
        secrets: { API_KEY: cannot.stored },
      });
      mayUse.add(`${ANA}:${team.metadata!.id}`);
      const over = resolverOver(cannot.secrets);
      const decrypt = vi.spyOn(cannot.secrets, "decrypt");
      // Optional, so a key silently dropped would let the run start without it.
      const init: ResolveInit = {
        run: runOf({ person: ANA }),
        session: sessionOf({ vaults: ["sealed"] }),
        agentSpec: agent({ API_KEY: { isSecret: true, optional: true } }),
      };
      expect((await plan(init, over)).map((entry) => entry.key)).toEqual(["API_KEY"]);
      expect(decrypt, "planning opens nothing").not.toHaveBeenCalled();
      const failure = await failureOfFetch(open(init, undefined, over));
      expect(failure).toBeInstanceOf(cannot.error);
      expect(failure.message).toBe(cannot.message);
      expect(failure.message).not.toContain(cannot.stored);
      expect(failure.message).not.toContain(SEALED_PLAINTEXT);
    },
  );

  it("a vault's value the run does not carry is never decrypted: one that cannot be opened refuses nothing", async () => {
    const cannot = await unopenable("tampered");
    const ana = testCallerIdentity({ identityId: ANA });
    const vaults = newVaultService({
      store: rig.store,
      logger: silentLogger,
      secretService: cannot.secrets,
      authorizationLifecycle: undefined,
    });
    const mine = await vaults.ensureMine(ORG, ana);
    const id = mine.metadata!.id;
    await vaults.setSecrets(
      id,
      { NEEDED: { value: "needed-value", description: "" }, UNUSED: { value: "unused-value", description: "" } },
      ana,
    );
    await vaults.setConnection(
      id,
      "https://mcp.unused.example/mcp",
      { token: "unused-login", source: VaultConnectionSource.pasted },
      ana,
    );
    // A value no key opens, beside them in the same vault.
    const row = await rig.store.getResource(ApiResourceKind.vault, id, VaultSchema);
    row.spec!.secrets["BROKEN"] = create(VaultSecretSchema, { value: cannot.stored });
    await rig.store.saveResource(ApiResourceKind.vault, id, VaultSchema, row);

    const decrypt = vi.spyOn(cannot.secrets, "decrypt");
    const values = await open(
      { run: runOf({ person: ANA }), agentSpec: agent({ NEEDED: KEY }) },
      undefined,
      resolverOver(cannot.secrets),
    );
    expect(flatten(values)).toEqual({ NEEDED: "needed-value" });
    // One decrypt, of the one value the run carries.
    expect(decrypt.mock.calls.map(([value]) => value)).toEqual([row.spec!.secrets["NEEDED"]!.value]);
  });

  it("the token of a repository the run does not clone is never decrypted: one that cannot be opened refuses nothing", async () => {
    const cannot = await unopenable("tampered");
    const own = await cannot.secrets.encrypt("own-value", EncryptionScope.forOrganization(ORG));
    const entry = (name: string, url: string, token: string) => ({
      name,
      source: { source: { case: "gitRepo" as const, value: { url, token } } },
    });
    const session = await stored(
      create(SessionSchema, {
        metadata: { id: "ses_resolve", org: ORG },
        spec: {
          workspaceEntries: [
            entry("app", "https://github.com/acme/app", own),
            entry("mirror", "https://git.example.com/acme/app", cannot.stored),
          ],
        },
      }),
    );
    const decrypt = vi.spyOn(cannot.secrets, "decrypt");
    const values = await open(
      { run: runOf({ person: ANA }), session, unsaved: true },
      undefined,
      resolverOver(cannot.secrets),
    );
    expect(flatten(values)).toEqual({ GITHUB_TOKEN: "own-value" });
    expect(decrypt.mock.calls.map(([value]) => value)).toEqual([own]);
  });

  it("a sign-in's refresh token is opened only to renew: one that cannot be opened refuses no run its fresh token serves", async () => {
    const cannot = await unopenable("tampered");
    const ana = testCallerIdentity({ identityId: ANA });
    const vaults = newVaultService({
      store: rig.store,
      logger: silentLogger,
      secretService: cannot.secrets,
      authorizationLifecycle: undefined,
    });
    const id = (await vaults.ensureMine(ORG, ana)).metadata!.id;
    await vaults.setConnection(
      id,
      "https://mcp.linear.example/mcp",
      {
        token: "linear-token",
        source: VaultConnectionSource.sign_in,
        signIn: {
          expiresAt: BigInt(Math.floor(Date.now() / 1000) + 3600),
          clientId: "c",
          authMethod: "mcp_oauth",
          tokenEndpoint: "https://linear.example/token",
          refreshToken: "r",
          loginApp: "",
        },
      },
      ana,
    );
    const row = await rig.store.getResource(ApiResourceKind.vault, id, VaultSchema);
    const login = row.spec!.connections["https://mcp.linear.example/mcp"]!;
    login.signIn!.refreshToken = cannot.stored;
    await rig.store.saveResource(ApiResourceKind.vault, id, VaultSchema, row);

    const decrypt = vi.spyOn(cannot.secrets, "decrypt");
    const linear = tool("linear", { target: "LINEAR_TOKEN" });
    const over = newVaultResolver({
      store: rig.store,
      logger: silentLogger,
      authorizer: useTable,
      secretService: cannot.secrets,
      vaults,
      platformClients: { findById: async () => undefined },
      freshener: newSignInFreshener({
        loginProviders: new Map(),
        vaults,
        store: rig.store,
        secretService: cannot.secrets,
        logger: silentLogger,
      }),
    });
    const values = await open({ run: runOf({ person: ANA }), tools: [linear] }, undefined, over);
    expect(toolValues(values, linear)).toEqual({ LINEAR_TOKEN: "linear-token" });
    expect(decrypt.mock.calls.map(([value]) => value)).toEqual([login.token]);
  });

  it.each(["no key configured", "tampered"] as const)(
    "a repository's own token (%s) refuses the fetch, and no value reaches it",
    async (how) => {
      const cannot = await unopenable(how);
      // A clone's token is optional, so a dropped one would let the run start unseen.
      const failure = await failureOfFetch(
        open(
          {
            run: runOf({ person: ANA }),
            session: sessionOf({ repo: { url: "https://github.com/acme/app", token: cannot.stored } }),
          },
          undefined,
          resolverOver(cannot.secrets),
        ),
      );
      expect(failure).toBeInstanceOf(cannot.error);
      expect(failure.message).toBe(cannot.message);
      expect(failure.message).not.toContain(cannot.stored);
      expect(failure.message).not.toContain(SEALED_PLAINTEXT);
    },
  );
});
