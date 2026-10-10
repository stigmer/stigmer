/**
 * Pins the run's credential resolver (domain/vault/resolve.ts) over a real
 * store and vault service, with a table Authorizer for `can_use`:
 *
 *   - requirements: the agent's keys, each tool's keys and its login key
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
 *   - every named vault checked again: a surface vault whose attacher lost
 *     the use, and a vault that is gone, refuse naming it and the surface;
 *     someone else's My vault listed on a conversation refuses;
 *   - matching: a login by its address first, then (a tool on GitHub's own
 *     API only, with or without a repository in the run) the github.com
 *     login, then a secret by name; a clone by its own token (the
 *     entry of that name and URL, never a same-named repository on another
 *     host) then its host then (github.com only) a GITHUB_TOKEN secret, a plain key
 *     falling back to its declaration's value; the GitHub tool and a clone
 *     sharing GITHUB_TOKEN; two different values for one key refused
 *     naming both declarers;
 *   - which tool a login fills: a sign-in and a pasted login alike, every
 *     HTTP tool at its URL (a sign-in renewed once however many tools use
 *     it), and none at another address; a local program has no address and
 *     takes its keys as secrets by name;
 *   - where a login's token may go when its key is shared: a tool it was
 *     not made for, a clone served by another tool's sign-in, a tool at
 *     another host than GitHub's API for the github.com login, and the
 *     agent's own key no tool claims are refused naming the key, the
 *     address and the declarer, before anything renews; a clone with a
 *     GitHub tool on api.github.com or api.githubcopilot.com, the agent's
 *     copy of its tool's key, and GITHUB_TOKEN beside a clone are served;
 *     a repository's own token goes only where the github.com login may,
 *     any other declarer of GITHUB_TOKEN refused, naming it; a secret by
 *     name still serves every declarer;
 *   - a missing required key refused naming what the conversation lacks,
 *     one sentence per case (My vault included; left out with vaults
 *     listed; left out with none; another organization's agent; a run with
 *     no person, with and without a surface); an optional one absent;
 *   - a sign-in freshened once per connection per run, and only once the
 *     run is past its missing-key and conflict checks; a refused renewal
 *     refusing the run (the sign-in slice's own freshener included), any
 *     other renewal fault INTERNAL without its text;
 *   - the surfaces found from server-stamped facts: the minting platform
 *     client, the schedule, the share and the channel (each of another
 *     organization contributes nothing);
 *   - a run of an agent of another organization, or one whose row cannot
 *     be read, reads no My vault for any requirement (the agent's keys,
 *     every tool's keys and login, a clone's token), even when the
 *     conversation includes it, while the conversation's listed vaults,
 *     its repositories' tokens and a person-less run's surface vaults
 *     still serve it; a missing key points at the conversation's vaults;
 *   - include_my_vault gives each turn its own sender's My vault: a
 *     second person's turn reads their own, never the first person's,
 *     and both take the conversation's repository tokens;
 *   - every value from a vault, a connection or a repository's token is
 *     carried as secret; only a declaration's own plain value stays plain;
 *     a value reaches the run only for a declared key;
 *   - the person is the one the run recorded, so recover resolves as
 *     create did; the stored session row, not a loader's redacted copy,
 *     holds the repository tokens and the vault choice, and a row that is
 *     gone refuses; a conversation's vault its person may not use refuses,
 *     telling them;
 *   - a stored value the server cannot open (no key configured, or
 *     tampered ciphertext), in a vault or as a repository's token,
 *     refuses the whole run with the decryption error: never its
 *     ciphertext passed on, never the key silently dropped; a vault's
 *     value the run does not carry is never decrypted, so one that cannot
 *     be opened refuses nothing, and a run decrypts only what it carries;
 *     so is the token of a repository the run does not clone, and a
 *     sign-in's refresh token unless the sign-in is renewed;
 *   - the connect lane: the request's own values first, then the caller's
 *     My vault for a human caller, none for a runner.
 */
import { randomBytes } from "node:crypto";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import type { AgentSpec } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { AgentChannelSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import { AgentShareSchema } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/api_pb";
import { ExecutionValueSchema } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/spec_pb";
import type { ExecutionValue } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/spec_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { PluginEvalSchema } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/api_pb";
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
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { PLUGIN_EVAL_LABEL } from "../../plugin-eval/constants.js";
import { newSignInFreshener } from "../sign-in/refresh.js";

import {
  CHANNEL_ID_LABEL_KEY,
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
  freshToken: async (vault, connection) => {
    freshened.push(`${vault.metadata?.id}|${connection.address}`);
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

async function resolveValues(init: ResolveInit): Promise<Map<string, ExecutionValue>> {
  const session = init.session ?? sessionOf();
  if (init.unsaved !== true) {
    await stored(session);
  }
  return resolver.resolveForRun({
    execution: init.run,
    session,
    agentSpec: init.agentSpec,
    agentName: "Helper",
    agentOrg: init.agentOrg === null ? undefined : (init.agentOrg ?? ORG),
    tools: init.tools ?? [],
  });
}

async function resolve(init: ResolveInit): Promise<Record<string, string>> {
  const values = await resolveValues(init);
  return Object.fromEntries([...values].map(([key, value]) => [key, value.value]));
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

  it("a plugin eval's vaults reach its tries, checked against their attacher", async () => {
    const keys = await seedSharedVault(rig.store, ORG, "eval-keys", { secrets: { A: "from-eval" } });
    await rig.store.saveResource(
      ApiResourceKind.plugin_eval,
      "pev_nightly",
      PluginEvalSchema,
      create(PluginEvalSchema, {
        metadata: { id: "pev_nightly", name: "thermos run", org: ORG },
        spec: { pluginId: "plg_thermos", vaults: [vaultRef("eval-keys")] },
        status: { vaultAttachers: { [keys.metadata!.id]: ADMIN } },
      }),
    );
    const evalTry = {
      run: runOf({ labels: { [PLUGIN_EVAL_LABEL]: "pev_nightly" } }),
      session: sessionOf({ includeMyVault: false }),
      agentSpec: agent({ A: KEY }),
    };
    const revoked = await refusal(resolve(evalTry));
    expect(revoked.rawMessage).toContain(
      "vault 'eval-keys', named by plugin eval 'thermos run', may no longer be used",
    );
    mayUse.add(`${ADMIN}:${keys.metadata!.id}`);
    expect(await resolve(evalTry)).toEqual({ A: "from-eval" });

    // A try acting as a person (open source acts as the eval's creator)
    // reads its conversation's vaults first, then the eval's.
    await seedSharedVault(rig.store, ORG, "chat-keys", { secrets: { B: "from-chat" } });
    mayUse.add(`${ANA}:vlt_acme_chat_keys`);
    expect(
      await resolve({
        run: runOf({ person: ANA, labels: { [PLUGIN_EVAL_LABEL]: "pev_nightly" } }),
        session: sessionOf({ vaults: ["chat-keys"], includeMyVault: false }),
        agentSpec: agent({ A: KEY, B: KEY }),
      }),
    ).toEqual({ A: "from-eval", B: "from-chat" });
  });

  it("a plugin eval that is gone, or of another organization, contributes no vaults to its tries", async () => {
    await seedSharedVault(rig.store, "rival", "rival-keys", { secrets: { API_KEY: "rival" } });
    await rig.store.saveResource(
      ApiResourceKind.plugin_eval,
      "pev_rival",
      PluginEvalSchema,
      create(PluginEvalSchema, {
        metadata: { id: "pev_rival", name: "rival", org: "rival" },
        spec: { pluginId: "plg_rival", vaults: [{ kind: ApiResourceKind.vault, org: "rival", slug: "rival-keys" }] },
        status: { vaultAttachers: { "vlt_rival_rival_keys": ADMIN } },
      }),
    );
    mayUse.add(`${ADMIN}:vlt_rival_rival_keys`);
    for (const evalId of ["pev_gone", "pev_rival"]) {
      expect(
        await resolve({
          run: runOf({ labels: { [PLUGIN_EVAL_LABEL]: evalId } }),
          agentSpec: agent({ API_KEY: { isSecret: true, optional: true } }),
        }),
      ).toEqual({});
    }
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

describe("which values the context carries as secret", () => {
  const PLAIN = { value: "acme-default" };

  it("a plain declaration's own value stays plain; a vault secret filling it is secret", async () => {
    const fromDeclaration = await resolveValues({
      run: runOf({ person: ANA }),
      agentSpec: agent({ WORKSPACE: PLAIN }),
    });
    expect(fromDeclaration.get("WORKSPACE")).toMatchObject({ value: "acme-default", isSecret: false });

    await anasVault({ WORKSPACE: "ana-workspace", BARE: "ana-bare" });
    const fromVault = await resolveValues({
      run: runOf({ person: ANA }),
      agentSpec: agent({ WORKSPACE: PLAIN, BARE: {} }),
    });
    expect(fromVault.get("WORKSPACE")).toMatchObject({ value: "ana-workspace", isSecret: true });
    expect(fromVault.get("BARE")).toMatchObject({ value: "ana-bare", isSecret: true });
  });

  it("a repository's own token is secret, and so is a listed vault's secret filling a plain declaration", async () => {
    const own = await resolveValues({
      run: runOf({ person: ANA }),
      session: sessionOf({ repo: { url: "https://github.com/acme/app", token: "repo-own" } }),
    });
    expect(own.get("GITHUB_TOKEN")).toMatchObject({ value: "repo-own", isSecret: true });

    const team = await seedSharedVault(rig.store, ORG, "integrator", { secrets: { WORKSPACE: "cust" } });
    mayUse.add(`${ADMIN}:${team.metadata!.id}`);
    const attached = await resolveValues({
      run: runOf(),
      session: sessionOf({ vaults: ["integrator"], attachers: { [team.metadata!.id]: ADMIN } }),
      agentSpec: agent({ WORKSPACE: PLAIN }),
    });
    expect(attached.get("WORKSPACE")).toMatchObject({ value: "cust", isSecret: true });
  });

  it("a connection's token is secret even where the tool declares its login key plain", async () => {
    const mine = await anasVault({});
    await rig.vaults.setConnection(
      mine,
      "https://mcp.linear.example/mcp",
      { token: "by-address", source: VaultConnectionSource.pasted },
      testCallerIdentity({ identityId: ANA }),
    );
    const values = await resolveValues({
      run: runOf({ person: ANA }),
      tools: [tool("linear", { target: "LINEAR_TOKEN", env: { LINEAR_TOKEN: {} } })],
    });
    expect(values.get("LINEAR_TOKEN")).toMatchObject({ value: "by-address", isSecret: true });
  });

  it("the connect lane keeps a plain default plain and marks a My vault value secret", async () => {
    await anasVault({ TEAM: "ana-team" });
    const values = await resolver.resolveForConnect({
      orgId: ORG,
      caller: testCallerIdentity({ identityId: BEN }),
      server: tool("linear", { env: { TEAM: PLAIN } }),
      ownValues: new Map(),
    });
    expect(values.get("TEAM")).toMatchObject({ value: "acme-default", isSecret: false });
    const anas = await resolver.resolveForConnect({
      orgId: ORG,
      caller: testCallerIdentity({ identityId: ANA }),
      server: tool("linear", { env: { TEAM: PLAIN } }),
      ownValues: new Map(),
    });
    expect(anas.get("TEAM")).toMatchObject({ value: "ana-team", isSecret: true });
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

  it("the GitHub tool on GitHub's own API and a clone share the github.com login as GITHUB_TOKEN; two different values for it refuse, naming both", async () => {
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

    const ownToken = sessionOf({ repo: { url: "https://github.com/acme/app", token: "a-different-pat" } });
    const conflict = await refusal(
      resolve({ run: runOf({ person: ANA }), session: ownToken, tools: [github] }),
    );
    expect(conflict.code).toBe(Code.FailedPrecondition);
    expect(conflict.rawMessage).toContain("GITHUB_TOKEN would carry two different values");
    expect(conflict.rawMessage).toContain("github gets one");
    expect(conflict.rawMessage).toContain("repository app another");
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

  it("a run refused for a missing key renews nothing", async () => {
    await signedIn();
    const failure = await refusal(
      resolve({
        run: runOf({ person: ANA }),
        agentSpec: agent({ MISSING: KEY }),
        tools: [tool("linear", { target: "LINEAR_TOKEN" })],
      }),
    );
    expect(failure.code).toBe(Code.FailedPrecondition);
    expect(failure.rawMessage).toContain("needs MISSING");
    expect(freshened).toEqual([]);
  });

  it("a run refused for two values of one key renews nothing", async () => {
    const mine = await signedIn();
    await rig.vaults.setSecrets(
      mine,
      { LINEAR_TOKEN: { value: "by-name", description: "" } },
      testCallerIdentity({ identityId: ANA }),
    );
    const failure = await refusal(
      resolve({
        run: runOf({ person: ANA }),
        agentSpec: agent({ LINEAR_TOKEN: KEY }),
        tools: [tool("linear", { target: "LINEAR_TOKEN" })],
      }),
    );
    expect(failure.rawMessage).toContain("LINEAR_TOKEN would carry two different values");
    expect(freshened).toEqual([]);
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
      faulty.resolveForRun({
        execution: runOf({ person: ANA }),
        session: await stored(sessionOf()),
        agentSpec: undefined,
        agentName: "",
        agentOrg: undefined,
        tools: [tool("linear", { target: "LINEAR_TOKEN" })],
      }),
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
    expect(failure.rawMessage).toContain("could not be renewed");
    expect(failure.rawMessage).toContain("Sign in again");
  });
});

// ---------------------------------------------------------------------------
// Where a login's token may go
// ---------------------------------------------------------------------------

describe("a login reaches only what it was made for", () => {
  const LINEAR_URL = "https://mcp.linear.example/mcp";

  /** Ana's My vault with a Linear sign-in made by mcp_linear; answers its id. */
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

  it("refuses a sign-in's token for another tool that declares its key, naming the key, the address and that tool, and renews nothing", async () => {
    await linearSignIn();
    const evil = tool("evil", {
      url: "https://evil.example/mcp",
      env: { LINEAR_TOKEN: KEY },
      headers: { Authorization: "Bearer ${LINEAR_TOKEN}" },
    });
    const failure = await refusal(
      resolve({
        run: runOf({ person: ANA }),
        tools: [tool("linear", { url: LINEAR_URL, target: "LINEAR_TOKEN" }), evil],
      }),
    );
    expect(failure.code).toBe(Code.FailedPrecondition);
    expect(failure.rawMessage).toContain("LINEAR_TOKEN would carry the login for https://mcp.linear.example/mcp");
    expect(failure.rawMessage).toContain("to evil");
    expect(failure.rawMessage).toContain("save it as a secret named LINEAR_TOKEN");
    expect(failure.rawMessage).not.toContain("linear-login");
    expect(freshened).toEqual([]);
  });

  it("refuses a pasted login for a tool at another URL, its login slot or a plain key alike", async () => {
    const mine = await anasVault({});
    await rig.vaults.setConnection(
      mine,
      LINEAR_URL,
      { token: "pasted-linear", source: VaultConnectionSource.pasted },
      testCallerIdentity({ identityId: ANA }),
    );
    for (const other of [
      tool("notes", { url: "https://mcp.linear.example/mcp/v2", target: "LINEAR_TOKEN" }),
      tool("notes", { url: "https://mcp.notes.example/mcp", env: { LINEAR_TOKEN: KEY } }),
    ]) {
      const failure = await refusal(
        resolve({
          run: runOf({ person: ANA }),
          tools: [tool("linear", { url: LINEAR_URL, target: "LINEAR_TOKEN" }), other],
        }),
      );
      expect(failure.code).toBe(Code.FailedPrecondition);
      expect(failure.rawMessage).toContain("to notes");
    }
  });

  it("refuses the github.com login a clone uses for a tool at another host that declares GITHUB_TOKEN", async () => {
    await githubLogin();
    for (const url of [
      "https://mcp.other.example/mcp",
      "https://api.github.com.evil.example/mcp",
      "http://api.github.com/mcp",
    ]) {
      const other = tool("other", {
        url,
        env: { GITHUB_TOKEN: KEY },
        headers: { Authorization: "Bearer ${GITHUB_TOKEN}" },
      });
      const failure = await refusal(
        resolve({ run: runOf({ person: ANA }), session: cloning(), tools: [other] }),
      );
      expect(failure.code).toBe(Code.FailedPrecondition);
      expect(failure.rawMessage).toContain("GITHUB_TOKEN would carry the login for github.com");
      expect(failure.rawMessage).toContain("to other");
    }
  });

  it("refuses a repository's own token for any other declarer of GITHUB_TOKEN than the clone, GitHub's API and the agent beside it, naming that declarer", async () => {
    const owned = (): Session =>
      sessionOf({ repo: { url: "https://github.com/acme/app", token: "repo-own" } });
    for (const other of [
      tool("other", {
        url: "https://evil.example/mcp",
        headers: { Authorization: "Bearer ${GITHUB_TOKEN}" },
      }),
      tool("other", {
        url: "https://api.github.com.evil.example/mcp",
        headers: { Authorization: "Bearer ${GITHUB_TOKEN}" },
      }),
      tool("other", { url: "https://mcp.other.example/mcp", env: { GITHUB_TOKEN: KEY } }),
    ]) {
      const failure = await refusal(
        resolve({ run: runOf({ person: ANA }), session: owned(), tools: [other] }),
      );
      expect(failure.code).toBe(Code.FailedPrecondition);
      expect(failure.rawMessage).toContain("GITHUB_TOKEN would carry repository app's own token");
      expect(failure.rawMessage).toContain("to other");
      expect(failure.rawMessage).toContain("remove the tool other");
      expect(failure.rawMessage).not.toContain("repo-own");
    }

    const github = tool("github", {
      url: "https://api.githubcopilot.com/mcp/",
      headers: { Authorization: "Bearer ${GITHUB_TOKEN}" },
    });
    expect(
      await resolve({
        run: runOf({ person: ANA }),
        session: owned(),
        agentSpec: agent({ GITHUB_TOKEN: KEY }),
        tools: [github],
      }),
      "the GitHub tool on GitHub's own API and the agent beside the clone",
    ).toEqual({ GITHUB_TOKEN: "repo-own" });
  });

  it("lets the github.com login serve a clone and a GitHub tool on GitHub's own API", async () => {
    await githubLogin();
    for (const url of ["https://api.githubcopilot.com/mcp/", "https://api.github.com/mcp"]) {
      const github = tool("github", {
        url,
        env: { GITHUB_TOKEN: KEY },
        headers: { Authorization: "Bearer ${GITHUB_TOKEN}" },
      });
      expect(
        await resolve({ run: runOf({ person: ANA }), session: cloning(), tools: [github] }),
      ).toEqual({ GITHUB_TOKEN: "gh-login" });
    }
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
      const failure = await refusal(resolve({ run: runOf({ person: ANA }), tools: [other] }));
      expect(failure.code).toBe(Code.FailedPrecondition);
      expect(failure.rawMessage).toContain("other needs GITHUB_TOKEN");
    }
  });

  it("lets the agent's copy of its tool's key share the sign-in: the runner keeps a key a tool claims out of the shell", async () => {
    await linearSignIn();
    const linear = tool("linear", { url: LINEAR_URL, env: { LINEAR_TOKEN: KEY }, target: "LINEAR_TOKEN" });
    expect(
      await resolve({
        run: runOf({ person: ANA }),
        agentSpec: agent({ LINEAR_TOKEN: KEY }),
        tools: [linear],
      }),
    ).toEqual({ LINEAR_TOKEN: "fresh-linear-login" });
  });

  it("refuses a sign-in's token for the agent's own key that no tool claims: the shell would hold it", async () => {
    await linearSignIn();
    // The login key named only by a header is not a key the runner
    // withholds from the shell.
    const linear = tool("linear", {
      url: LINEAR_URL,
      headers: { Authorization: "Bearer ${LINEAR_TOKEN}" },
    });
    const failure = await refusal(
      resolve({
        run: runOf({ person: ANA }),
        agentSpec: agent({ LINEAR_TOKEN: KEY }),
        tools: [linear],
      }),
    );
    expect(failure.code).toBe(Code.FailedPrecondition);
    expect(failure.rawMessage).toContain("to the agent Helper");
    expect(freshened).toEqual([]);
  });

  it("lets the agent declare GITHUB_TOKEN beside a github.com clone: the clone puts the token in the shell's reach already", async () => {
    await githubLogin();
    expect(
      await resolve({
        run: runOf({ person: ANA }),
        session: cloning(),
        agentSpec: agent({ GITHUB_TOKEN: KEY }),
      }),
    ).toEqual({ GITHUB_TOKEN: "gh-login" });
  });

  it("refuses another tool's sign-in for a clone: only the github.com login is for github.com", async () => {
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
    const failure = await refusal(
      resolve({ run: runOf({ person: ANA }), session: cloning(), tools: [proxy] }),
    );
    expect(failure.code).toBe(Code.FailedPrecondition);
    expect(failure.rawMessage).toContain("to repository app");
    expect(freshened).toEqual([]);
  });

  it("still shares a secret by name with every declarer of its key", async () => {
    await anasVault({ LINEAR_TOKEN: "linear-pat" });
    const evil = tool("evil", {
      url: "https://evil.example/mcp",
      headers: { Authorization: "Bearer ${LINEAR_TOKEN}" },
    });
    expect(
      await resolve({
        run: runOf({ person: ANA }),
        agentSpec: agent({ LINEAR_TOKEN: KEY }),
        tools: [tool("linear", { url: LINEAR_URL, target: "LINEAR_TOKEN" }), evil],
      }),
    ).toEqual({ LINEAR_TOKEN: "linear-pat" });
  });
});

// ---------------------------------------------------------------------------
// The connect lane
// ---------------------------------------------------------------------------

describe("resolveForConnect", () => {
  const linear = tool("linear", { target: "LINEAR_TOKEN", env: { TEAM: { value: "core" } } });

  it("the request's own values come first, then a human caller's My vault", async () => {
    await anasVault({ LINEAR_TOKEN: "ana-token" });
    const human = testCallerIdentity({ identityId: ANA });
    const fromVault = await resolver.resolveForConnect({
      orgId: ORG,
      caller: human,
      server: linear,
      ownValues: new Map(),
    });
    expect(fromVault.get("LINEAR_TOKEN")?.value).toBe("ana-token");
    expect(fromVault.get("TEAM")?.value).toBe("core");

    const own = await resolver.resolveForConnect({
      orgId: ORG,
      caller: human,
      server: linear,
      ownValues: new Map([
        ["LINEAR_TOKEN", create(ExecutionValueSchema, { value: "one-time", isSecret: true })],
      ]),
    });
    expect(own.get("LINEAR_TOKEN")?.value).toBe("one-time");
  });

  it("a runner caller reads no My vault: its own values are all it has", async () => {
    await anasVault({ LINEAR_TOKEN: "ana-token" });
    const failure = await refusal(
      resolver.resolveForConnect({
        orgId: ORG,
        caller: testCallerIdentity({ identityId: ANA, callerClass: "runner" }),
        server: linear,
        ownValues: new Map(),
      }),
    );
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
      outage.resolveForRun({
        execution: runOf({ person: ANA }),
        session: await stored(sessionOf({ vaults: ["team"] })),
        agentSpec: agent({ API_KEY: KEY }),
        agentName: "Helper",
        agentOrg: ORG,
        tools: [],
      }),
    ).rejects.toThrow("fga down");
  });

  it("a store fault reading the conversation propagates", async () => {
    await expect(
      resolverWith({
        getResource: async () => {
          throw new Error("disk gone");
        },
      }).resolveForRun({
        execution: runOf({ person: ANA }),
        session: sessionOf(),
        agentSpec: undefined,
        agentName: "",
        agentOrg: undefined,
        tools: [],
      }),
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
      faulty.resolveForRun({
        execution: runOf({ labels: { [SCHEDULE_ID_LABEL_KEY]: "sch_any" } }),
        session: await stored(sessionOf()),
        agentSpec: undefined,
        agentName: "",
        agentOrg: undefined,
        tools: [],
      }),
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
      real.resolveForRun({
        execution: runOf({ person: ANA }),
        session: await stored(sessionOf()),
        agentSpec: undefined,
        agentName: "",
        agentOrg: undefined,
        tools: [tool("linear", { target: "LINEAR_TOKEN" })],
      }),
    );
    expect(failure.code).toBe(Code.FailedPrecondition);
    expect(failure.rawMessage).toBe(
      "the sign-in for https://mcp.linear.example/mcp in My vault could not be renewed: " +
        "it has expired and no refresh token is available. Sign in again",
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
      refusing.resolveForRun({
        execution: runOf({ person: ANA }),
        session: await stored(sessionOf()),
        agentSpec: undefined,
        agentName: "",
        agentOrg: undefined,
        tools: [tool("linear", { target: "LINEAR_TOKEN" })],
      }),
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

  /** The run's failure; a run that resolves fails the test, naming what it carried. */
  async function failureOfRun(run: Promise<Map<string, ExecutionValue>>): Promise<Error> {
    let values: Map<string, ExecutionValue>;
    try {
      values = await run;
    } catch (error) {
      if (error instanceof Error) {
        return error;
      }
      throw error;
    }
    throw new Error(`expected the run refused; it carried ${JSON.stringify([...values.keys()])}`);
  }

  it.each(["no key configured", "tampered"] as const)(
    "a vault's secret (%s) refuses the run, and no value reaches it",
    async (how) => {
      const cannot = await unopenable(how);
      const team = await seedSharedVault(rig.store, ORG, "sealed", {
        secrets: { API_KEY: cannot.stored },
      });
      mayUse.add(`${ANA}:${team.metadata!.id}`);
      // Optional, so a key silently dropped would let the run start without it.
      const failure = await failureOfRun(
        resolverOver(cannot.secrets).resolveForRun({
          execution: runOf({ person: ANA }),
          session: await stored(sessionOf({ vaults: ["sealed"] })),
          agentSpec: agent({ API_KEY: { isSecret: true, optional: true } }),
          agentName: "Helper",
          agentOrg: ORG,
          tools: [],
        }),
      );
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
    const values = await resolverOver(cannot.secrets).resolveForRun({
      execution: runOf({ person: ANA }),
      session: await stored(sessionOf()),
      agentSpec: agent({ NEEDED: KEY }),
      agentName: "Helper",
      agentOrg: ORG,
      tools: [],
    });
    expect(Object.fromEntries([...values].map(([key, value]) => [key, value.value]))).toEqual({
      NEEDED: "needed-value",
    });
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
    const values = await resolverOver(cannot.secrets).resolveForRun({
      execution: runOf({ person: ANA }),
      session,
      agentSpec: undefined,
      agentName: "",
      agentOrg: undefined,
      tools: [],
    });
    expect(Object.fromEntries([...values].map(([key, value]) => [key, value.value]))).toEqual({
      GITHUB_TOKEN: "own-value",
    });
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
    const values = await newVaultResolver({
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
    }).resolveForRun({
      execution: runOf({ person: ANA }),
      session: await stored(sessionOf()),
      agentSpec: undefined,
      agentName: "",
      agentOrg: undefined,
      tools: [tool("linear", { target: "LINEAR_TOKEN" })],
    });
    expect(values.get("LINEAR_TOKEN")?.value).toBe("linear-token");
    expect(decrypt.mock.calls.map(([value]) => value)).toEqual([login.token]);
  });

  it.each(["no key configured", "tampered"] as const)(
    "a repository's own token (%s) refuses the run, and no value reaches it",
    async (how) => {
      const cannot = await unopenable(how);
      // A clone's token is optional, so a dropped one would let the run start unseen.
      const failure = await failureOfRun(
        resolverOver(cannot.secrets).resolveForRun({
          execution: runOf({ person: ANA }),
          session: await stored(
            sessionOf({ repo: { url: "https://github.com/acme/app", token: cannot.stored } }),
          ),
          agentSpec: undefined,
          agentName: "",
          agentOrg: undefined,
          tools: [],
        }),
      );
      expect(failure).toBeInstanceOf(cannot.error);
      expect(failure.message).toBe(cannot.message);
      expect(failure.message).not.toContain(cannot.stored);
      expect(failure.message).not.toContain(SEALED_PLAINTEXT);
    },
  );
});
