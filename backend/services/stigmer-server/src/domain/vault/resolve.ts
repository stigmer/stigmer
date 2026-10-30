/**
 * The run's credential resolver: the one rule that decides where each
 * value a run needs lives, refuses the run before it starts when a
 * required one is nowhere, and, when the run's work starts, opens exactly
 * those entries as they are then. Nothing is copied between the two.
 *
 * What a run needs (requirements), each with its declarer:
 *   - every key its agent declares (`AgentSpec.env`), except a key any
 *     tool or plugin of the run declares: a tool's key never reaches the
 *     agent's shell, even when the agent declares the same name;
 *   - every key each subagent declares, by the same rule, for that
 *     subagent's shell and hooks only (its own declarer, matched on its
 *     own);
 *   - every key each tool it uses reads (each MCP server the agent and its
 *     subagents write themselves, and each MCP server of each plugin the
 *     agent, its subagents and the conversation list; domain/run/
 *     run-servers.ts), and each tool's login key: the variable its
 *     `Authorization: Bearer ${VAR}` header names, or, for a server written
 *     in an agent that sends no Authorization header of its own, the
 *     optional `<SERVER>_ACCESS_TOKEN`, found by the server's address;
 *   - every key each listed plugin's hooks read, for those hooks only;
 *   - GITHUB_TOKEN for each github.com repository the session clones
 *     (optional: a public repository needs none). The runner sends that
 *     key only to git for an HTTPS URL whose host is github.com, so a
 *     repository on another host asks for nothing, and a token for
 *     another host never fills it.
 *
 * Where values come from, in order (the first source holding a match wins):
 *   1. a repository's own token, for its clone only;
 *   2. for a run with a person, when the stored session sets
 *      include_my_vault: that person's My vault;
 *   3. the session's vaults, in order;
 *   4. for a run with no person only, the vaults of the surface it came
 *      through, found from server-stamped facts: the minting platform
 *      client (the run's audit), its routine (the run's
 *      stigmer.ai/routine-id), its eval run (the run's
 *      stigmer.ai/eval-run), its channel of any type (the session's
 *      stigmer.ai/channel-id). A surface of another
 *      organization than the run's contributes nothing. An eval run's
 *      vaults also serve a try that acts as a person (open source acts as
 *      the eval's creator), after its conversation's: a try's conversation
 *      names none, and the eval's vaults are what its hooks and servers
 *      were given.
 * A conversation uses exactly what it chose: an integrator calling with an
 * admin's key, which leaves include_my_vault off, never reaches the
 * admin's own logins, and an agent carries no vaults of its own.
 *
 * A run whose agent is of another organization than the run's, or whose
 * agent's row cannot be read, reads no My vault for any requirement: not
 * the agent's keys, not any tool's keys or login, not a clone's token. Its
 * author answers to another organization, and every value the run carries
 * reaches the agent's code, whoever declared it. Only the vaults the
 * caller listed for this conversation (and, for a run with no person, its
 * surface's vaults) serve such a run; a required key missing from them
 * says so.
 *
 * include_my_vault is the conversation's choice, and each turn's My vault
 * is its own person's: a second person's turn never reads the first's. A
 * turn with no person ignores it.
 *
 * A participant's turn (a person the conversation is shared with sends a
 * message into it) records no person: the run's person is stamped only
 * for the conversation's creator (domain/run/plan-run-values-step.ts
 * StampRunCredentials), so nobody's personal logins serve it, neither the
 * sender's (they would enter the creator's workspace) nor the creator's
 * (the sender would act as them). It reads only the vaults the
 * conversation names, each checked for the account that attached it, never
 * a surface's: a conversation that began through a chat link must not
 * hand a participant the vaults its owner attached for the link's
 * visitors. It is told to ask the conversation's creator, who may edit
 * the conversation, and its value reads are attributed to its sender. A
 * participant's turn is recognised from the stamps: no person, and the
 * run's creator is not the conversation's (`participantSenderOf`).
 *
 * Every vault a run names is checked when the run is planned and again
 * when its values are opened: `can_use` for the run's person, or, for a
 * run with no person, for the account recorded as having attached it (the
 * surface's `vault_attachers`). A vault that is gone or no longer passes
 * refuses, naming it and the surface.
 *
 * Matching is per declarer: each requirement is matched on its own, and
 * one key may come from different places for different declarers.
 *   - A tool's login key: a connection at the tool's address, for an HTTP
 *     tool (the login server minted the token for that address); then,
 *     for an HTTP tool served over HTTPS from GitHub's own API
 *     (GITHUB_API_HOSTS, default port), the github.com connection; then a
 *     secret of that name.
 *   - A clone: the repository's own token (the entry of that name and
 *     URL, so a same-named repository on another host never lends its
 *     token), then the github.com connection, then a GITHUB_TOKEN secret.
 *   - Any other key, the agent's included: a secret of its name, then a
 *     plain declaration's own value. A connection and a repository's token
 *     reach only the tool or clone they were made for, never the agent.
 * A local program has no address and takes no login: its keys are secrets
 * by name.
 *
 * Planning (planRun, at create and on recover) reads which names and
 * addresses each vault holds from the sealed row; it decrypts nothing and
 * renews nothing. Its result
 * is the run's source manifest (RunStatus.credentials.sources): for each
 * key and declarer, the vault by id and the entry, never a value. A
 * required key nothing holds refuses the create with FAILED_PRECONDITION
 * naming the key, its declarer and what the conversation lacks; an
 * optional one has no entry.
 *
 * Opening (openRun, when the run's work starts) reads the manifest and
 * opens exactly the entries it names, as they are then: a rotated secret
 * is picked up, and nothing is matched again. Each named vault is checked
 * again (the rules above, and that the conversation still names it); each
 * tool filled from a connection is loaded and its address checked against
 * the connection's, so a login never follows a tool moved elsewhere since
 * the run was planned; each sign-in is renewed once through the
 * SignInFreshener, which writes the renewal back to its vault in the run's
 * person's name. An entry gone since, a vault the run may no longer use, a
 * tool moved elsewhere, a value that cannot be opened or a renewal the
 * provider refuses (SignInRenewalError) refuses with FAILED_PRECONDITION
 * naming the key, its declarer and the vault, and saying to fix it and
 * recover; any other fault during renewal is INTERNAL. The values are
 * answered grouped by declarer: the agent's, each subagent's by its name,
 * each tool's with the URL the fetch read (a plugin's tool read at the
 * archive the run planned, an agent's at the agent version the run
 * planned), each plugin's for its hooks,
 * each repository's token.
 *
 * A manifest names where a value lives and carries no value, except a
 * plain declaration's own default, a fixed setting of the agent or tool
 * that is no secret. What the fetch answers is the values alone: whoever
 * receives one treats every value as secret.
 *
 * A tools listing has no conversation: planConnect reads the listing
 * person's My vault only, for the one server listed (a sign-in saved into a
 * shared vault serves the runs that use that vault, never a listing).
 *
 * Proven by __tests__/resolve.test.ts and the vault conformance suites.
 */
import { create } from "@bufbuild/protobuf";
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";

import type { AgentSpec } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import { ChannelSchema } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/api_pb";
import { PluginSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import type { McpServerEntry, PluginStatus } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/status_pb";
import { EvalRunSchema } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/api_pb";
import { RunValueSourceSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type { Run, RunValueDeclarer, RunValueSource } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import {
  RunValueDeclarerKind,
  RunValueOrigin,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { RoutineSchema } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import type { Session } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import type { Vault } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/api_pb";
import { EnvVarDeclarationSchema } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/declaration_pb";
import type { EnvVarDeclaration } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/declaration_pb";
import { VaultConnectionSource } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/spec_pb";
import {
  ExecutionValuesSchema,
  PluginValuesSchema,
  RepositoryValuesSchema,
  SubagentValuesSchema,
  ToolValuesSchema,
} from "@stigmer/apis/ai/stigmer/agentic/vault/v1/values_pb";
import type {
  ExecutionValues,
  PluginValues,
  SubagentValues,
  ToolValues,
} from "@stigmer/apis/ai/stigmer/agentic/vault/v1/values_pb";
import { hookVariableReferences, RUNNER_FILLED_VARIABLES } from "@stigmer/plugin-package";
import { accessTokenVariable } from "@stigmer/tool-vocabulary";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { OrganizationSchema } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import type { ApiResourceReference } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";
import { IamPermission } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";

import type { Logger } from "../../boot/logger.js";
import type { SecretService } from "../../encryption/encryption.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import { isFirstPartyHumanOperator } from "../../extensions/identity.js";
import { serverActingFor } from "../../pipeline/interceptors/auth.js";
import { loadVersion } from "../../pipeline/steps/version-history.js";
import { agentVersionBinding } from "../agent/versions.js";
import { pluginVersionBinding } from "../plugin/versions.js";
import { failedPreconditionError, internalError } from "../../pipeline/errors.js";
import { evaluateAuthorizer } from "../../pipeline/steps/authorize.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import { runServers } from "../run/run-servers.js";
import type { RunServer } from "../run/run-servers.js";
import type { RunSubagent } from "../run/run-subagents.js";
import { evalRunOfRun } from "../eval-run/run-label.js";
import { ROUTINE_ID_LABEL_KEY } from "../routine/labels.js";
import type { IdentityAccountStore } from "../identityaccount/store.js";
import { sessionIdOf } from "../run/target.js";

import { gitHostOf, toolAddressOf } from "./address.js";
import { agentServerEntry } from "./agent-servers.js";
import { GITHUB_HOST } from "./constants.js";
import type {
  OpenedConnection,
  SealedConnection,
  SealedValue,
  VaultService,
} from "./service.js";
import { personOf } from "./service.js";
import { openSessionValues, repositoryTokenKey } from "./session-values.js";
import type { SessionOwnValues } from "./session-values.js";

/** The audit link a routine stamps on every run it starts (temporal/routine/run-starter.ts). */
export { ROUTINE_ID_LABEL_KEY };

/**
 * The lineage every conversation a channel serves carries, whatever its
 * type: a chat link's guest sessions (stamped by the edition's guest lane)
 * and a Slack or WhatsApp channel's (stamped by its runtime) alike
 * (domain/session/list-index.ts).
 */
export const CHANNEL_ID_LABEL_KEY = "stigmer.ai/channel-id";

/** The key every clone reads its token from (the runner's workspace provisioner). */
export const CLONE_TOKEN_KEY = "GITHUB_TOKEN";

/**
 * GitHub's own API hosts. A github.com login is for GitHub's APIs, so the
 * github.com connection may also fill the login of an HTTP tool served
 * over HTTPS from one of these (the GitHub MCP server at
 * api.githubcopilot.com): connecting GitHub, then using the GitHub tool,
 * keeps working, while a tool on any other host never receives that login.
 */
export const GITHUB_API_HOSTS: ReadonlySet<string> = new Set([
  "api.github.com",
  "api.githubcopilot.com",
]);

/**
 * A sign-in that cannot be renewed: it has no refresh token, or the
 * provider refused it. Its message is the cause alone ("it has expired and
 * no refresh token is available"): the resolver names the address and the
 * vault and adds the one instruction to sign in again before it reaches
 * the person. Any other error a freshener throws is a fault.
 */
export class SignInRenewalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignInRenewalError";
  }
}

/** Renews a sign-in's token when it has expired; implemented by the sign-in slice. */
export interface SignInFreshener {
  /**
   * The connection's usable access token: renewed first when expired and
   * a refresh token exists, the renewal written back to its vault. Throws
   * a SignInRenewalError naming the cause when the renewal itself fails.
   * An expired sign-in is renewed from the login the vault holds now, so
   * the token may be the vault's current login when the read has moved,
   * and a login removed since the read is refused.
   */
  freshToken(
    vault: Vault,
    connection: OpenedConnection,
    caller: CallerIdentity,
  ): Promise<string>;
}

/**
 * The saved resource a tool is part of, at the version the run planned,
 * which the fetch reads the server at: a plugin's archive (its digest; an
 * empty digest reads the plugin as it is now), or an agent's version (its
 * hash).
 */
export type ToolHome =
  | { readonly kind: "plugin"; readonly pluginId: string; readonly pluginDigest: string }
  | { readonly kind: "agent"; readonly agentId: string; readonly agentVersion: string };

/** Who declares a requirement. */
export type Declarer =
  | { readonly kind: "agent"; readonly name: string }
  | {
      readonly kind: "tool";
      /**
       * `plugin:<plugin>:<server>`, as Claude Code names a plugin's server;
       * a server written in an agent by its own name, as Claude Code names
       * a server added directly.
       */
      readonly name: string;
      readonly server: string;
      readonly home: ToolHome;
    }
  | { readonly kind: "plugin"; readonly name: string; readonly pluginId: string }
  | { readonly kind: "repository"; readonly name: string; readonly url: string }
  /** A saved agent the run's agent lists, by its name in the turn (its slug). */
  | { readonly kind: "subagent"; readonly name: string };

/** A plugin a run lists, at the version it resolved to. */
export interface RunPlugin {
  readonly id: string;
  readonly name: string;
  readonly status: PluginStatus;
}

/** One value a run needs. */
export interface Requirement {
  readonly key: string;
  readonly declarer: Declarer;
  readonly optional: boolean;
  /** A tool's login slot: matched by a connection at this address first. */
  readonly loginAddress?: string;
  /**
   * The tool behind a login slot: whether it sends its login to its own
   * address (an HTTP server, whose address is its URL; only such a tool
   * takes a login by address).
   */
  readonly tool?: { readonly sendsToAddress: boolean };
  /**
   * A github.com clone: matched by the repository's own token (the entry
   * of this name and URL), then a github.com connection, then a
   * GITHUB_TOKEN secret.
   */
  readonly clone?: { readonly entryName: string; readonly url: string };
  /** A plain setting's own value, the last fallback. */
  readonly plainValue?: string;
  /** Whether the declarer is a tool with a sign-in (says "sign in" when missing). */
  readonly signIn?: boolean;
}

/** A source of values, in resolution order; nothing is opened while planning. */
interface Source {
  /** "My vault", "vault 'Support tools'", for the messages. */
  readonly label: string;
  readonly origin: RunValueOrigin;
  /** The vault row; absent for the conversation's repository tokens. */
  readonly vault?: Vault;
  readonly secrets: ReadonlyMap<string, SealedValue>;
  readonly connections: ReadonlyMap<string, SealedConnection>;
  /** Keyed by repositoryTokenKey (name and URL). */
  readonly repositoryTokens?: ReadonlyMap<string, SealedValue>;
}

/** Whose turn it is to act when a required key is nowhere. */
/** A surface a run came through: what names it, its vaults and who attached each. */
interface RunSurface {
  readonly what: string;
  readonly refs: readonly ApiResourceReference[];
  readonly attachers: { readonly [id: string]: string };
  readonly org: string;
}

type WhoActs =
  | { readonly kind: "person"; readonly includesMyVault: boolean; readonly listsVaults: boolean }
  | { readonly kind: "foreignAgent" }
  | { readonly kind: "surface"; readonly what: string }
  | { readonly kind: "participant"; readonly creator: string }
  | { readonly kind: "none" };

export interface VaultResolverDeps {
  readonly store: Store;
  readonly logger: Logger;
  readonly authorizer: Authorizer;
  readonly secretService: SecretService;
  readonly vaults: VaultService;
  /** Where the service account that minted an app user's token is read, for its organization. */
  readonly accounts: Pick<IdentityAccountStore, "findById">;
  readonly freshener: SignInFreshener;
}

/** What a run brings to the planner: the run, its session, its agent at the recorded version, every tool it uses. */
export interface RunCredentialInput {
  readonly execution: Run;
  readonly session: Session;
  readonly agentSpec: AgentSpec | undefined;
  readonly agentName: string;
  /** The agent's id, and the version the run planned (its stamped hash); empty for a run with no agent. */
  readonly agentId: string;
  readonly agentVersion: string;
  /**
   * The organization the agent belongs to, or undefined when its row
   * cannot be read. A run of another organization's agent (or an
   * unreadable one) reads no My vault, for any requirement.
   */
  readonly agentOrg: string | undefined;
  /** The subagents the agent lists, at their pinned versions (domain/run/run-subagents.ts). */
  readonly subagents: readonly RunSubagent[];
  /** Every plugin the run lists (its agent's, its conversation's and its subagents'), each once. */
  readonly plugins: readonly RunPlugin[];
}

/** A tools listing's planning input: whose My vault, in which organization, for which server. */
export interface ConnectPlanInput {
  readonly orgId: string;
  /** The listing person; undefined for a caller who is no first-party person (reads no vault). */
  readonly person: string | undefined;
  readonly server: RunServer;
}

export interface VaultResolver {
  /** The run's source manifest: where each value it needs lives. Refuses a required key nothing holds. */
  planRun(input: RunCredentialInput): Promise<RunValueSource[]>;
  /** The values a stored run's manifest names, opened as they are now and grouped by declarer. */
  openRun(execution: Run): Promise<ExecutionValues>;
  /** A listing's plan: the server's requirements over the person's My vault. */
  planConnect(input: ConnectPlanInput): Promise<RunValueSource[]>;
  /** A listing's values: planned now over the person's My vault, then opened. */
  openConnect(input: ConnectPlanInput): Promise<ExecutionValues>;
}

/** The person whose turn a caller's request is: the platform's one rule, recorded at create. */
export function runPersonOfCaller(caller: CallerIdentity): string | undefined {
  return isFirstPartyHumanOperator(caller) && caller.identityId !== ""
    ? caller.identityId
    : undefined;
}

/** The person a stored run recorded, or undefined for a run no person sent. */
export function recordedRunPerson(execution: Run): string | undefined {
  return execution.status?.credentials?.person;
}

/**
 * The sender of a participant's turn (the module header), or undefined for
 * any other run: a run that recorded no person, whose creator stamp names
 * someone other than the conversation's creator (a conversation that
 * records no creator has none to compare). A surface's run (a guest,
 * a channel, a schedule, an app user) is created by the same
 * account that created its conversation, so it is never one.
 */
export function participantSenderOf(
  execution: Run,
  session: Session,
): string | undefined {
  if (recordedRunPerson(execution) !== undefined) {
    return undefined;
  }
  const sender = execution.status?.audit?.specAudit?.createdBy?.id ?? "";
  const creator = session.status?.audit?.specAudit?.createdBy?.id ?? "";
  return sender !== "" && creator !== "" && sender !== creator ? sender : undefined;
}

/** The conversation's creator in a sentence: their name, or a role when the row has none. */
function creatorLabel(session: Session): string {
  const creator = session.status?.audit?.specAudit?.createdBy;
  const name = creator?.displayName || creator?.email || "";
  return name === "" ? "the conversation's owner" : name;
}

// ---------------------------------------------------------------------------
// Requirements
// ---------------------------------------------------------------------------

const BEARER_VARIABLE = /^\s*Bearer\s+\$\{([A-Za-z_][A-Za-z0-9_]*)\}\s*$/i;

/** A tool's login key: the variable its `Authorization: Bearer ${VAR}` header names. */
export function loginKeyOf(server: McpServerEntry): string | undefined {
  const transport = server.transport;
  if (transport.case !== "http") {
    return undefined;
  }
  for (const [header, value] of Object.entries(transport.value.headers)) {
    if (header.toLowerCase() !== "authorization") {
      continue;
    }
    const match = BEARER_VARIABLE.exec(value);
    if (match !== null) {
      return match[1];
    }
  }
  return undefined;
}

/** `plugin:<plugin>:<server>`, as Claude Code names a plugin's server. */
export function toolNameOf(pluginName: string, serverName: string): string {
  return `plugin:${pluginName}:${serverName}`;
}

function declarationRequirements(
  env: { readonly [key: string]: EnvVarDeclaration },
  declarer: Declarer,
): Requirement[] {
  return Object.entries(env).map(([key, declaration]) => ({
    key,
    declarer,
    optional: declaration.optional,
    ...(declaration.isSecret || declaration.value === ""
      ? {}
      : { plainValue: declaration.value }),
  }));
}

/**
 * The declarations of the keys a server reads; a name the plugin did not
 * declare is a required secret, and a key the runner always fills
 * (`RUNNER_FILLED_VARIABLES`) is none.
 */
function declarationsOf(server: RunServer): Record<string, EnvVarDeclaration> {
  const declarations: Record<string, EnvVarDeclaration> = {};
  for (const name of server.entry.env) {
    if (RUNNER_FILLED_VARIABLES.has(name)) {
      continue;
    }
    declarations[name] =
      server.env[name] ?? create(EnvVarDeclarationSchema, { isSecret: true, optional: false });
  }
  return declarations;
}

/** A server's declarer: its name in the messages and the home the fetch reads it from. */
function toolDeclarerOf(server: RunServer): Declarer {
  const home = server.home;
  switch (home.kind) {
    case "plugin":
      return {
        kind: "tool",
        name: toolNameOf(home.pluginName, server.entry.name),
        server: server.entry.name,
        home: { kind: "plugin", pluginId: home.pluginId, pluginDigest: home.pluginDigest },
      };
    case "agent":
      return {
        kind: "tool",
        name: server.entry.name,
        server: server.entry.name,
        home: { kind: "agent", agentId: home.agentId, agentVersion: home.agentVersion },
      };
    /* v8 ignore next -- @preserve: the exhaustiveness guard over a closed union; no value reaches it */
    default: {
      const unreachable: never = home;
      return unreachable;
    }
  }
}

/** Whether an HTTP server sends an Authorization header of its own. */
function sendsAuthorization(entry: McpServerEntry): boolean {
  return (
    entry.transport.case === "http" &&
    Object.keys(entry.transport.value.headers).some((header) => header.toLowerCase() === "authorization")
  );
}

/**
 * Every requirement of a tool: its declarations, with its login key
 * marked. A server written in an agent that sends no Authorization header
 * of its own also takes an optional login, `<SERVER>_ACCESS_TOKEN`: a
 * connection at its address, else a secret of that name, else none, and
 * the server is called with no login (the runner adds the header only when
 * a value arrived).
 */
export function toolRequirements(server: RunServer): Requirement[] {
  const declarer = toolDeclarerOf(server);
  const loginKey = loginKeyOf(server.entry);
  const address = toolAddressOf(server.entry);
  const signIn = server.entry.signIn !== undefined;
  const tool = {
    sendsToAddress: server.entry.transport.case === "http",
  };
  const requirements = declarationRequirements(declarationsOf(server), declarer).map(
    (requirement): Requirement => {
      if (requirement.key !== loginKey || address === undefined) {
        return requirement;
      }
      // A login is never a plain setting.
      const { plainValue: _plain, ...login } = requirement;
      return { ...login, loginAddress: address, tool, signIn };
    },
  );
  // A login named by a key the runner always fills is no login: no vault
  // value may stand in for who is calling.
  if (
    loginKey !== undefined &&
    !RUNNER_FILLED_VARIABLES.has(loginKey) &&
    !requirements.some((requirement) => requirement.key === loginKey)
  ) {
    requirements.push({
      key: loginKey,
      declarer,
      optional: false,
      signIn,
      ...(address === undefined ? {} : { loginAddress: address, tool }),
    });
  }
  const optionalLogin = accessTokenVariable(server.entry.name);
  if (
    server.home.kind === "agent" &&
    address !== undefined &&
    !sendsAuthorization(server.entry) &&
    !requirements.some((requirement) => requirement.key === optionalLogin)
  ) {
    requirements.push({ key: optionalLogin, declarer, optional: true, loginAddress: address, tool, signIn: false });
  }
  return requirements;
}

/** Every key a plugin's hooks read, declared by the plugin, for those hooks only. */
export function pluginHookRequirements(plugin: RunPlugin): Requirement[] {
  const hooks = plugin.status.hooks;
  if (hooks === undefined) {
    return [];
  }
  const declarations: Record<string, EnvVarDeclaration> = {};
  for (const name of hookVariableReferences(hooks)) {
    // A key the runner always fills is no vault's to give a hook either: a
    // hook reading it gets nothing, and the turn names the variable, rather
    // than a saved value standing in for who is calling.
    if (RUNNER_FILLED_VARIABLES.has(name)) {
      continue;
    }
    declarations[name] =
      plugin.status.env[name] ?? create(EnvVarDeclarationSchema, { isSecret: true, optional: false });
  }
  return declarationRequirements(declarations, {
    kind: "plugin",
    name: plugin.name,
    pluginId: plugin.id,
  });
}

/**
 * Every requirement of a run. The agent's own declaration of a key any of
 * the run's tools or plugins declares is no requirement of the agent's:
 * that key is theirs, and the agent's shell never holds it.
 */
export function runRequirements(input: RunCredentialInput): Requirement[] {
  const servers = runServers({
    agent:
      input.agentSpec === undefined
        ? undefined
        : { id: input.agentId, name: input.agentName, version: input.agentVersion, spec: input.agentSpec },
    subagents: input.subagents,
    plugins: input.plugins,
  });
  const tools = servers.flatMap(toolRequirements);
  const hooks = input.plugins.flatMap(pluginHookRequirements);
  const pluginKeys = new Set([...tools, ...hooks].map((requirement) => requirement.key));
  const requirements: Requirement[] = [];
  if (input.agentSpec !== undefined) {
    requirements.push(
      ...declarationRequirements(input.agentSpec.env, {
        kind: "agent",
        name: input.agentName,
      }).filter((requirement) => !pluginKeys.has(requirement.key)),
    );
  }
  // Each subagent's own keys, for its shell and its own hooks only: the
  // agent's rule for a second agent of the run.
  for (const subagent of input.subagents) {
    requirements.push(
      ...declarationRequirements(subagent.spec.env, {
        kind: "subagent",
        name: subagent.name,
      }).filter((requirement) => !pluginKeys.has(requirement.key)),
    );
  }
  requirements.push(...tools, ...hooks);
  for (const entry of input.session.spec?.resources ?? []) {
    const source = entry.resource;
    if (source.case !== "gitRepository" || gitHostOf(source.value.url) !== GITHUB_HOST) {
      continue;
    }
    requirements.push({
      key: CLONE_TOKEN_KEY,
      declarer: {
        kind: "repository",
        // The repository's own name, empty or not: the runner matches its
        // repository by name and URL exactly as the session carries them.
        // The messages fall back to the URL.
        name: entry.name,
        url: source.value.url,
      },
      optional: true,
      clone: { entryName: entry.name, url: source.value.url },
    });
  }
  return requirements;
}

// ---------------------------------------------------------------------------
// Matching (planning: nothing is opened)
// ---------------------------------------------------------------------------

/** Where a requirement's value lives, found without opening it. */
type Location =
  | { readonly kind: "secret"; readonly source: Source; readonly name: string }
  | { readonly kind: "connection"; readonly source: Source; readonly address: string }
  | { readonly kind: "repositoryToken"; readonly source: Source; readonly entryName: string }
  | { readonly kind: "plain"; readonly value: string };

/** Whether a login's address is an HTTPS URL on one of GitHub's own API hosts, at its default port. */
function onGitHubApi(address: string): boolean {
  const url = URL.canParse(address) ? new URL(address) : undefined;
  return url?.protocol === "https:" && url.port === "" && GITHUB_API_HOSTS.has(url.hostname);
}

function connectionAt(source: Source, address: string): Location | undefined {
  const connection = source.connections.get(address);
  if (connection?.present !== true) {
    return undefined;
  }
  return { kind: "connection", source, address };
}

function secretNamed(source: Source, name: string): Location | undefined {
  return source.secrets.get(name)?.present === true
    ? { kind: "secret", source, name }
    : undefined;
}

function locate(requirement: Requirement, sources: readonly Source[]): Location | undefined {
  for (const source of sources) {
    if (requirement.clone !== undefined) {
      const own = source.repositoryTokens?.get(
        repositoryTokenKey(requirement.clone.entryName, requirement.clone.url),
      );
      if (own?.present === true) {
        return { kind: "repositoryToken", source, entryName: requirement.clone.entryName };
      }
      const found = connectionAt(source, GITHUB_HOST) ?? secretNamed(source, CLONE_TOKEN_KEY);
      if (found !== undefined) {
        return found;
      }
      continue;
    }
    if (requirement.loginAddress !== undefined && requirement.tool?.sendsToAddress === true) {
      const login =
        connectionAt(source, requirement.loginAddress) ??
        (onGitHubApi(requirement.loginAddress) ? connectionAt(source, GITHUB_HOST) : undefined);
      if (login !== undefined) {
        return login;
      }
    }
    const secret = secretNamed(source, requirement.key);
    if (secret !== undefined) {
      return secret;
    }
  }
  if (requirement.plainValue !== undefined) {
    return { kind: "plain", value: requirement.plainValue };
  }
  return undefined;
}

const DECLARER_KINDS: Readonly<Record<Declarer["kind"], RunValueDeclarerKind>> = {
  agent: RunValueDeclarerKind.AGENT,
  tool: RunValueDeclarerKind.TOOL,
  plugin: RunValueDeclarerKind.PLUGIN,
  repository: RunValueDeclarerKind.REPOSITORY,
  subagent: RunValueDeclarerKind.SUBAGENT,
};

/** A manifest entry for a located requirement. */
function sourceEntry(requirement: Requirement, location: Location): RunValueSource {
  const { declarer } = requirement;
  const entry = create(RunValueSourceSchema, {
    key: requirement.key,
    declarer: {
      kind: DECLARER_KINDS[declarer.kind],
      name: declarer.name,
      pluginId:
        declarer.kind === "plugin"
          ? declarer.pluginId
          : declarer.kind === "tool" && declarer.home.kind === "plugin"
            ? declarer.home.pluginId
            : "",
      server: declarer.kind === "tool" ? declarer.server : "",
      pluginDigest: declarer.kind === "tool" && declarer.home.kind === "plugin" ? declarer.home.pluginDigest : "",
      agentId: declarer.kind === "tool" && declarer.home.kind === "agent" ? declarer.home.agentId : "",
      agentVersion: declarer.kind === "tool" && declarer.home.kind === "agent" ? declarer.home.agentVersion : "",
      repositoryUrl: declarer.kind === "repository" ? declarer.url : "",
    },
  });
  switch (location.kind) {
    case "plain":
      entry.origin = RunValueOrigin.DECLARATION;
      entry.plainValue = location.value;
      return entry;
    case "repositoryToken":
      entry.origin = RunValueOrigin.REPOSITORY_TOKEN;
      entry.entry = location.entryName;
      return entry;
    case "secret":
      entry.origin = location.source.origin;
      entry.vaultId = location.source.vault?.metadata?.id ?? "";
      entry.entry = location.name;
      return entry;
    case "connection":
      entry.origin = location.source.origin;
      entry.vaultId = location.source.vault?.metadata?.id ?? "";
      entry.entry = location.address;
      entry.login = true;
      return entry;
    /* v8 ignore next -- @preserve: the exhaustiveness guard over a closed union; no value reaches it */
    default: {
      const unreachable: never = location;
      return unreachable;
    }
  }
}

/** How the messages name each kind of declarer. */
const DECLARER_WORDS: Readonly<Record<Declarer["kind"], (name: string) => string>> = {
  agent: (name) => `the agent ${name}`,
  tool: (name) => name,
  plugin: (name) => `the hooks of plugin ${name}`,
  repository: (name) => `repository ${name}`,
  subagent: (name) => `the subagent ${name}`,
};

function describeDeclarer(declarer: Declarer): string {
  const name =
    declarer.kind === "repository" && declarer.name === "" ? declarer.url : declarer.name;
  return DECLARER_WORDS[declarer.kind](name);
}

/**
 * What the conversation lacks, in words a console and an API caller both
 * act on: the vaults it uses and whether it includes My vault.
 */
function whoActsSentence(requirement: Requirement, who: WhoActs): string {
  const what =
    requirement.signIn === true
      ? `sign in to ${describeDeclarer(requirement.declarer)}, or add ${requirement.key}`
      : `add ${requirement.key}`;
  switch (who.kind) {
    case "surface":
      return `ask the owner of ${who.what} to attach a vault that holds ${requirement.key}`;
    case "none":
      return `list a vault that holds ${requirement.key} on the conversation`;
    case "participant":
      return `ask ${who.creator} to list a vault that holds ${requirement.key} on the conversation`;
    case "foreignAgent":
      return `add ${requirement.key} to one of this conversation's vaults: an agent of another organization never reads My vault`;
    case "person":
      if (who.includesMyVault) {
        return `${what} to My vault`;
      }
      return who.listsVaults
        ? `${what} to one of this conversation's vaults, or include My vault in this conversation`
        : `this conversation uses no vaults: include My vault in it, or list a vault that holds ${requirement.key}`;
    /* v8 ignore next -- @preserve: the exhaustiveness guard over a closed union; no value reaches it */
    default: {
      const unreachable: never = who;
      return unreachable;
    }
  }
}

function missingMessage(requirement: Requirement, who: WhoActs): string {
  return `${describeDeclarer(requirement.declarer)} needs ${requirement.key}: ${whoActsSentence(requirement, who)}`;
}

/** Matches every requirement over the sources; refuses every required key nothing holds, in one message. */
function plan(
  requirements: readonly Requirement[],
  sources: readonly Source[],
  who: WhoActs,
): RunValueSource[] {
  const planned: RunValueSource[] = [];
  const missing: string[] = [];
  for (const requirement of requirements) {
    const location = locate(requirement, sources);
    if (location === undefined) {
      if (!requirement.optional) {
        missing.push(missingMessage(requirement, who));
      }
      continue;
    }
    planned.push(sourceEntry(requirement, location));
  }
  if (missing.length > 0) {
    throw failedPreconditionError(missing.join("; "));
  }
  return planned;
}

// ---------------------------------------------------------------------------
// Opening (the fetch: exactly the entries a manifest names)
// ---------------------------------------------------------------------------

/** A manifest entry's declarer, in the messages' words. */
function declarerOfEntry(entry: RunValueSource): Declarer {
  const declarer = entry.declarer;
  switch (declarer?.kind) {
    case RunValueDeclarerKind.TOOL:
      return { kind: "tool", name: declarer.name, server: declarer.server, home: toolHomeOf(declarer) };
    case RunValueDeclarerKind.PLUGIN:
      return { kind: "plugin", name: declarer.name, pluginId: declarer.pluginId };
    case RunValueDeclarerKind.REPOSITORY:
      return { kind: "repository", name: declarer.name, url: declarer.repositoryUrl };
    case RunValueDeclarerKind.SUBAGENT:
      return { kind: "subagent", name: declarer.name };
    default:
      return { kind: "agent", name: declarer?.name ?? "" };
  }
}

/** One tool's values group: its home's kind and id, and its server. */
function toolGroupKey(home: ToolHome, server: string): string {
  return home.kind === "plugin"
    ? `plugin\u0000${home.pluginId}\u0000${server}`
    : `agent\u0000${home.agentId}\u0000${server}`;
}

/** A manifest's tool declarer's home: an agent's when it names one, else its plugin's. */
function toolHomeOf(declarer: RunValueDeclarer): ToolHome {
  return declarer.agentId !== ""
    ? { kind: "agent", agentId: declarer.agentId, agentVersion: declarer.agentVersion }
    : { kind: "plugin", pluginId: declarer.pluginId, pluginDigest: declarer.pluginDigest };
}

/** A refusal at the fetch: the key, its declarer, what went wrong, and the way out. */
function unopenable(entry: RunValueSource, what: string, retry: string): ConnectError {
  return failedPreconditionError(
    `${describeDeclarer(declarerOfEntry(entry))} needs ${entry.key}, but ${what}. Fix it, then ${retry}`,
  );
}

/** A vault a manifest may name, checked for this execution; or why it may not be used now. */
type CheckedVault =
  | { readonly ok: true; readonly vault: Vault; readonly label: string }
  | { readonly ok: false; readonly why: string };

/** What opening needs beyond the manifest: the vaults it may read, the repository tokens, whose name a renewal is in. */
interface OpenScope {
  /** The vault a manifest entry names, checked again; called once per vault. */
  vaultFor(entry: RunValueSource): Promise<CheckedVault>;
  readonly repositoryTokens: ReadonlyMap<string, SealedValue>;
  readonly actor: CallerIdentity;
  /** The way out a refusal names: "recover the turn" for a run, "list the tools again" for a listing. */
  readonly retry: string;
}

/** A vault a run names, with what to say about it and whose permission to ask. */
interface NamedVault {
  readonly ref: ApiResourceReference;
  /** "this conversation", "routine 'nightly'", for the messages. */
  readonly namedBy: string;
  /** Whose can_use to ask; undefined refuses (nobody recorded attaching it). */
  readonly principal: string | undefined;
  readonly fallbackOrgId: string;
}

function principalAsCaller(principal: string): CallerIdentity {
  return { identityId: principal, callerClass: "user", issuer: "", rawToken: "" };
}

function vaultLabel(vault: Vault): string {
  return `vault '${vault.metadata?.name || vault.metadata?.slug || vault.metadata?.id || ""}'`;
}

const NO_REPOSITORY_TOKENS: ReadonlyMap<string, SealedValue> = new Map();

export function newVaultResolver(deps: VaultResolverDeps): VaultResolver {
  const { logger } = deps;

  async function mayUse(principal: string, vault: Vault): Promise<boolean> {
    const decision = await evaluateAuthorizer(deps.authorizer, principalAsCaller(principal), {
      permission: IamPermission.can_use,
      resourceKind: ApiResourceKind.vault,
      resourceId: vault.metadata?.id ?? "",
    });
    if (decision.kind === "unavailable") {
      throw decision.cause;
    }
    return decision.kind === "allow";
  }

  /**
   * Why a named vault may not serve this run, or undefined when it may: a
   * My vault reaches only its own person's runs, and a person-less run only
   * through its owner's own routine; any other vault needs `can_use` for
   * the principal.
   */
  async function refusalOf(
    entry: NamedVault,
    vault: Vault,
    person: string | undefined,
  ): Promise<string | undefined> {
    const owner = personOf(vault);
    if (owner !== undefined && owner !== person && entry.principal !== owner) {
      return `${vaultLabel(vault)}, named by ${entry.namedBy}, is someone's own My vault and serves only their runs`;
    }
    const principal = entry.principal;
    const allowed = principal !== undefined && (await mayUse(principal, vault));
    if (allowed) {
      return undefined;
    }
    return principal === undefined
      ? `${vaultLabel(vault)}, named by ${entry.namedBy}, has no record of who attached it: attach it again`
      : principal === person
        ? `${vaultLabel(vault)}, named by ${entry.namedBy}, is not one you may use: ask a vault admin for its use, or remove it from ${entry.namedBy}`
        : `${vaultLabel(vault)}, named by ${entry.namedBy}, may no longer be used by the account that attached it: ask a vault admin to grant it again, or attach another vault`;
  }

  async function findNamed(entry: NamedVault): Promise<Vault> {
    const vault = await deps.vaults.findByReference(entry.ref, entry.fallbackOrgId);
    if (vault === undefined) {
      // A vault that is gone has no name left; its id is what the
      // reference holds.
      const refText = `${entry.ref.org || entry.fallbackOrgId}/${entry.ref.slug !== "" ? entry.ref.slug : entry.ref.id}`;
      throw failedPreconditionError(
        `vault ${refText}, named by ${entry.namedBy}, no longer exists: remove it from ${entry.namedBy} or create it again`,
      );
    }
    return vault;
  }

  /** Loads and checks the named vaults, in order, as sources of `origin`. */
  async function namedSources(
    named: readonly NamedVault[],
    person: string | undefined,
    origin: RunValueOrigin,
  ): Promise<Source[]> {
    const sources: Source[] = [];
    const seen = new Set<string>();
    for (const entry of named) {
      const vault = await findNamed(entry);
      const id = vault.metadata?.id ?? "";
      if (seen.has(id)) {
        continue;
      }
      const refused = await refusalOf(entry, vault, person);
      if (refused !== undefined) {
        throw failedPreconditionError(refused);
      }
      seen.add(id);
      sources.push(vaultSource(vaultLabel(vault), origin, vault));
    }
    return sources;
  }

  /** A vault as a source: its entries, sealed. */
  function vaultSource(label: string, origin: RunValueOrigin, vault: Vault): Source {
    const sealed = deps.vaults.entries(vault);
    return { label, origin, vault, secrets: sealed.secrets, connections: sealed.connections };
  }

  /** A conversation's repository tokens: they match their own clone only. */
  function repositorySource(values: SessionOwnValues): Source {
    return {
      label: "the conversation's repositories",
      origin: RunValueOrigin.REPOSITORY_TOKEN,
      secrets: new Map(),
      connections: new Map(),
      repositoryTokens: values.repositoryTokens,
    };
  }

  /** The surface a person-less run came through, with its vaults and attachers. */
  async function surfaceOf(
    execution: Run,
    session: Session,
  ): Promise<{ what: string; named: NamedVault[] } | undefined> {
    const executionOrg = execution.metadata?.org ?? "";
    const surfaces: RunSurface[] = [];

    const mintedBy =
      execution.status?.audit?.specAudit?.createdBy?.mintedBy ?? "";
    if (mintedBy !== "") {
      const minter = await deps.accounts.findById(mintedBy);
      const minterOrg = minter?.metadata?.org ?? "";
      const organization =
        minterOrg !== "" && minterOrg === executionOrg
          ? await loadOptional(ApiResourceKind.organization, minterOrg, OrganizationSchema)
          : undefined;
      if (organization !== undefined) {
        surfaces.push({
          what: "the organization's embedding settings",
          refs: organization.spec?.embedding?.vaults ?? [],
          attachers: organization.status?.embeddingVaultAttachers ?? {},
          org: executionOrg,
        });
      }
    }
    // A surface of another organization than the run's contributes
    // nothing: the label naming it is checked against the row it names,
    // so no label, however it was written, reaches another organization's
    // vaults or a My vault its owner attached there.
    const sameOrganization = (kind: string, id: string, org: string): boolean => {
      if (org === executionOrg) {
        return true;
      }
      logger.warn("A run's surface belongs to another organization; its vaults are not used", {
        kind,
        id,
        executionId: execution.metadata?.id ?? "",
      });
      return false;
    };
    const routineId = execution.metadata?.labels[ROUTINE_ID_LABEL_KEY] ?? "";
    if (routineId !== "") {
      const routine = await loadOptional(ApiResourceKind.routine, routineId, RoutineSchema);
      const invocation = routine?.spec?.agent;
      if (
        routine !== undefined &&
        invocation !== undefined &&
        sameOrganization("routine", routineId, routine.metadata?.org ?? "")
      ) {
        surfaces.push({
          what: `routine '${routine.metadata?.name ?? routineId}'`,
          refs: invocation.vaults,
          attachers: routine.status?.vaultAttachers ?? {},
          org: executionOrg,
        });
      }
    }
    const evalSurface = await evalRunSurfaceOf(execution);
    if (evalSurface !== undefined) {
      surfaces.push(evalSurface);
    }
    const channelId = session.metadata?.labels[CHANNEL_ID_LABEL_KEY] ?? "";
    if (channelId !== "") {
      const channel = await loadOptional(ApiResourceKind.channel, channelId, ChannelSchema);
      if (channel !== undefined && sameOrganization("channel", channelId, channel.metadata?.org ?? "")) {
        surfaces.push({
          what: `channel '${channel.metadata?.name ?? channelId}'`,
          refs: channel.spec?.vaults ?? [],
          attachers: channel.status?.vaultAttachers ?? {},
          org: executionOrg,
        });
      }
    }
    if (surfaces.length === 0) {
      return undefined;
    }
    return {
      what: surfaces.map((surface) => surface.what).join(" and "),
      named: await namedOf(surfaces),
    };
  }

  /** Each surface's vaults, in order, each with the account that attached it. */
  async function namedOf(surfaces: readonly RunSurface[]): Promise<NamedVault[]> {
    const named: NamedVault[] = [];
    for (const surface of surfaces) {
      for (const ref of surface.refs) {
        const vault = await deps.vaults.findByReference(ref, surface.org);
        named.push({
          ref,
          namedBy: surface.what,
          principal:
            vault === undefined ? undefined : surface.attachers[vault.metadata?.id ?? ""],
          fallbackOrgId: surface.org,
        });
      }
    }
    return named;
  }

  /**
   * The eval run a try belongs to (the run's stigmer.ai/eval-run, which
   * only the eval run's workflow stamps; domain/eval-run/run-label.ts
   * evalRunOfRun), as a surface; undefined when the run is no try, or its
   * eval run is gone or of another organization.
   */
  async function evalRunSurfaceOf(execution: Run): Promise<RunSurface | undefined> {
    const evalRunId = evalRunOfRun(execution);
    if (evalRunId === undefined) {
      return undefined;
    }
    const executionOrg = execution.metadata?.org ?? "";
    const row = await loadOptional(ApiResourceKind.eval_run, evalRunId, EvalRunSchema);
    if (row === undefined) {
      return undefined;
    }
    if ((row.metadata?.org ?? "") !== executionOrg) {
      logger.warn("A run's surface belongs to another organization; its vaults are not used", {
        kind: "eval run",
        id: evalRunId,
        executionId: execution.metadata?.id ?? "",
      });
      return undefined;
    }
    return {
      what: `eval run '${row.metadata?.name ?? evalRunId}'`,
      refs: row.spec?.vaults ?? [],
      attachers: row.status?.vaultAttachers ?? {},
      org: executionOrg,
    };
  }

  async function loadOptional<Desc extends DescMessage>(
    kind: ApiResourceKind,
    id: string,
    schema: Desc,
  ): Promise<MessageShape<Desc> | undefined> {
    try {
      return await deps.store.getResource(kind, id, schema);
    } catch (error) {
      if (error instanceof ResourceNotFoundError) {
        logger.warn("A run's surface row is gone; its vaults are not used", { kind: ApiResourceKind[kind], id });
        return undefined;
      }
      throw error;
    }
  }

  /**
   * The stored session row, not a loader's copy: every read the session
   * controller answers shows the marker in place of a repository's token,
   * and only the row holds it sealed. A row that is gone refuses: a copy's
   * tokens and vault choice are nothing to run on.
   */
  async function storedSession(sessionId: string): Promise<Session> {
    try {
      return await deps.store.getResource(ApiResourceKind.session, sessionId, SessionSchema);
    } catch (error) {
      if (error instanceof ResourceNotFoundError) {
        throw failedPreconditionError(
          `conversation ${sessionId} no longer exists: start a new conversation`,
        );
      }
      throw error;
    }
  }

  /** The vaults a conversation lists, each with whose `can_use` to ask. */
  async function sessionNamed(
    stored: Session,
    person: string | undefined,
    executionOrg: string,
  ): Promise<NamedVault[]> {
    const attachers = stored.status?.vaultAttachers ?? {};
    const named: NamedVault[] = [];
    for (const ref of stored.spec?.vaults ?? []) {
      let principal = person;
      if (principal === undefined) {
        const vault = await deps.vaults.findByReference(ref, executionOrg);
        principal = vault === undefined ? undefined : attachers[vault.metadata?.id ?? ""];
      }
      named.push({ ref, namedBy: "this conversation", principal, fallbackOrgId: executionOrg });
    }
    return named;
  }

  async function planRun(input: RunCredentialInput): Promise<RunValueSource[]> {
    const { execution } = input;
    const executionOrg = execution.metadata?.org ?? "";
    const person = recordedRunPerson(execution);
    const requirements = runRequirements(input);
    const stored = await storedSession(input.session.metadata?.id ?? "");
    const own = openSessionValues(deps.secretService, stored);
    const sessionRefs = stored.spec?.vaults ?? [];
    const includesMyVault = stored.spec?.includeMyVault === true;
    const named = await sessionNamed(stored, person, executionOrg);

    // A run of another organization's agent, or of one whose row cannot be
    // read, or whose agent lists another organization's agent as a
    // subagent: every value the run carries reaches that agent's code, so
    // the person's My vault stays closed to every requirement, its tools'
    // and its clones' included.
    const hasAgent = input.agentSpec !== undefined || input.agentName !== "";
    const foreignAgent =
      (hasAgent && (input.agentOrg === undefined || input.agentOrg !== executionOrg)) ||
      input.subagents.some((subagent) => subagent.org !== executionOrg);

    const sources: Source[] = [repositorySource(own)];
    let who: WhoActs;
    if (person !== undefined) {
      who = foreignAgent
        ? { kind: "foreignAgent" }
        : { kind: "person", includesMyVault, listsVaults: sessionRefs.length > 0 };
      if (includesMyVault && !foreignAgent) {
        const mine = await deps.vaults.findMine(executionOrg, person);
        if (mine !== undefined) {
          sources.push(vaultSource("My vault", RunValueOrigin.MY_VAULT, mine));
        }
      }
      sources.push(...(await namedSources(named, person, RunValueOrigin.VAULT)));
      // An eval run's try acting as its creator: the eval's vaults serve it
      // after the conversation's, checked against who attached each.
      const evalSurface = await evalRunSurfaceOf(execution);
      if (evalSurface !== undefined) {
        sources.push(
          ...(await namedSources(await namedOf([evalSurface]), person, RunValueOrigin.SURFACE_VAULT)),
        );
      }
    } else if (participantSenderOf(execution, stored) !== undefined) {
      // A participant's turn: the conversation's own vaults, never a surface's.
      sources.push(...(await namedSources(named, undefined, RunValueOrigin.VAULT)));
      who = { kind: "participant", creator: creatorLabel(stored) };
    } else {
      sources.push(...(await namedSources(named, undefined, RunValueOrigin.VAULT)));
      const surface = await surfaceOf(execution, stored);
      who = surface === undefined ? { kind: "none" } : { kind: "surface", what: surface.what };
      if (surface !== undefined) {
        sources.push(
          ...(await namedSources(surface.named, undefined, RunValueOrigin.SURFACE_VAULT)),
        );
      }
    }

    const planned = plan(requirements, sources, who);
    logger.info("Planned run values", {
      executionId: execution.metadata?.id ?? "",
      hasPerson: person !== undefined,
      sources: sources.length,
      entries: planned.length,
    });
    return planned;
  }

  /**
   * The vaults a stored run may read now, by id: My vault while the
   * conversation still includes it, each vault the conversation (or, for a
   * run with no person that is no participant's, its surface) still names,
   * each checked again.
   */
  function runScopeVaults(
    execution: Run,
    stored: Session,
    person: string | undefined,
  ): (entry: RunValueSource) => Promise<CheckedVault> {
    const executionOrg = execution.metadata?.org ?? "";
    let named: Promise<Map<string, { entry: NamedVault; vault: Vault; origin: RunValueOrigin }>> | undefined;
    const namedById = (): Promise<Map<string, { entry: NamedVault; vault: Vault; origin: RunValueOrigin }>> => {
      named ??= (async () => {
        const byId = new Map<string, { entry: NamedVault; vault: Vault; origin: RunValueOrigin }>();
        const add = async (list: readonly NamedVault[], origin: RunValueOrigin): Promise<void> => {
          for (const entry of list) {
            const vault = await deps.vaults.findByReference(entry.ref, entry.fallbackOrgId);
            const id = vault?.metadata?.id ?? "";
            if (vault !== undefined && !byId.has(id)) {
              byId.set(id, { entry, vault, origin });
            }
          }
        };
        await add(await sessionNamed(stored, person, executionOrg), RunValueOrigin.VAULT);
        if (person !== undefined) {
          // An eval run's try acting as its creator: the eval's vaults are
          // the run's, as the plan found them.
          const evalSurface = await evalRunSurfaceOf(execution);
          if (evalSurface !== undefined) {
            await add(await namedOf([evalSurface]), RunValueOrigin.SURFACE_VAULT);
          }
        } else if (participantSenderOf(execution, stored) === undefined) {
          const surface = await surfaceOf(execution, stored);
          if (surface !== undefined) {
            await add(surface.named, RunValueOrigin.SURFACE_VAULT);
          }
        }
        // A participant's turn reads the conversation's own vaults only, as
        // its plan did.
        return byId;
      })();
      return named;
    };
    return async (entry) => {
      if (entry.origin === RunValueOrigin.MY_VAULT) {
        if (person === undefined || stored.spec?.includeMyVault !== true) {
          return { ok: false, why: "this conversation no longer includes My vault" };
        }
        const mine = await deps.vaults.findMine(executionOrg, person);
        if (mine === undefined || mine.metadata?.id !== entry.vaultId) {
          return { ok: false, why: "My vault no longer exists" };
        }
        return { ok: true, vault: mine, label: "My vault" };
      }
      const found = (await namedById()).get(entry.vaultId);
      if (found === undefined || found.origin !== entry.origin) {
        return {
          ok: false,
          why: `vault ${entry.vaultId} is no longer one this conversation uses`,
        };
      }
      const refused = await refusalOf(found.entry, found.vault, person);
      return refused === undefined
        ? { ok: true, vault: found.vault, label: vaultLabel(found.vault) }
        : { ok: false, why: refused };
    };
  }

  /**
   * A tool's server at the version the run planned: its plugin's archive
   * (the digest), or its agent's version (the hash), so a run on a pinned
   * version is checked against what it dials, not against a later push or
   * edit; the head when no version was recorded. Undefined when the home
   * or that version is gone, or holds no server of that name.
   */
  async function loadTool(home: ToolHome, server: string): Promise<McpServerEntry | undefined> {
    try {
      switch (home.kind) {
        case "plugin": {
          const plugin =
            home.pluginDigest === ""
              ? await deps.store.getResource(ApiResourceKind.plugin, home.pluginId, PluginSchema)
              : (await loadVersion(deps.store, pluginVersionBinding, home.pluginId, home.pluginDigest)).resource;
          return plugin.status?.mcpServers.find((entry) => entry.name === server);
        }
        case "agent": {
          const agent = (await loadVersion(deps.store, agentVersionBinding, home.agentId, home.agentVersion)).resource;
          const written = agent.spec?.mcpServers.find((entry) => entry.name === server);
          return written === undefined ? undefined : agentServerEntry(written);
        }
        /* v8 ignore next -- @preserve: the exhaustiveness guard over a closed union; no value reaches it */
        default: {
          const unreachable: never = home;
          return unreachable;
        }
      }
    } catch (error) {
      if (error instanceof ResourceNotFoundError) {
        return undefined;
      }
      if (error instanceof ConnectError && error.code === Code.NotFound) {
        return undefined;
      }
      throw error;
    }
  }

  /** Whether a connection at `address` may still fill the login of `tool` as it is now. */
  function loginStillFor(tool: McpServerEntry, address: string): boolean {
    const toolAddress = toolAddressOf(tool);
    if (toolAddress === undefined) {
      return false;
    }
    return toolAddress === address || (address === GITHUB_HOST && onGitHubApi(toolAddress));
  }

  /** Opens a manifest's entries, as they are now, grouped by declarer. */
  async function open(
    entries: readonly RunValueSource[],
    scope: OpenScope,
  ): Promise<ExecutionValues> {
    const values = create(ExecutionValuesSchema);
    const vaults = new Map<string, Promise<CheckedVault>>();
    const renewals = new Map<string, Promise<string>>();
    const tools = new Map<string, ToolValues>();
    const plugins = new Map<string, PluginValues>();
    const subagents = new Map<string, SubagentValues>();
    const loadedTools = new Map<string, Promise<McpServerEntry | undefined>>();
    const toolOf = (home: ToolHome, server: string): Promise<McpServerEntry | undefined> => {
      const key = `${toolGroupKey(home, server)}\u0000${home.kind === "plugin" ? home.pluginDigest : home.agentVersion}`;
      let loaded = loadedTools.get(key);
      if (loaded === undefined) {
        loaded = loadTool(home, server);
        loadedTools.set(key, loaded);
      }
      return loaded;
    };

    for (const entry of entries) {
      const declarer = entry.declarer;
      let value: string;
      switch (entry.origin) {
        case RunValueOrigin.DECLARATION:
          value = entry.plainValue;
          break;
        case RunValueOrigin.REPOSITORY_TOKEN: {
          const sealed = scope.repositoryTokens.get(
            repositoryTokenKey(entry.entry, declarer?.repositoryUrl ?? ""),
          );
          if (sealed?.present !== true) {
            throw unopenable(entry, "the conversation no longer holds that repository's token", scope.retry);
          }
          value = await sealed.open();
          break;
        }
        case RunValueOrigin.MY_VAULT:
        case RunValueOrigin.VAULT:
        case RunValueOrigin.SURFACE_VAULT: {
          let checked = vaults.get(entry.vaultId);
          if (checked === undefined) {
            checked = scope.vaultFor(entry);
            vaults.set(entry.vaultId, checked);
          }
          const vault = await checked;
          if (!vault.ok) {
            throw unopenable(entry, vault.why, scope.retry);
          }
          const sealed = deps.vaults.entries(vault.vault);
          if (entry.login) {
            const connection = sealed.connections.get(entry.entry);
            if (connection?.present !== true) {
              throw unopenable(entry, `${vault.label} no longer holds a login for ${entry.entry}`, scope.retry);
            }
            if (declarer?.kind === RunValueDeclarerKind.TOOL) {
              const tool = await toolOf(toolHomeOf(declarer), declarer.server);
              if (tool === undefined || !loginStillFor(tool, entry.entry)) {
                throw unopenable(
                  entry,
                  `the tool is no longer at ${entry.entry}, the address its login in ${vault.label} was made for`,
                  scope.retry,
                );
              }
            }
            const once = `${entry.vaultId}\u0000${entry.entry}`;
            let renewal = renewals.get(once);
            if (renewal === undefined) {
              renewal = openLogin(entry, vault.vault, vault.label, connection, scope.actor, scope.retry);
              renewals.set(once, renewal);
            }
            value = await renewal;
          } else {
            const secret = sealed.secrets.get(entry.entry);
            if (secret?.present !== true) {
              throw unopenable(entry, `${vault.label} no longer holds a secret named ${entry.entry}`, scope.retry);
            }
            value = await secret.open();
          }
          break;
        }
        default:
          throw internalError(
            new Error(`origin ${String(entry.origin)}`),
            `the run's source manifest names ${entry.key} with no origin`,
          );
      }

      switch (declarer?.kind) {
        case RunValueDeclarerKind.TOOL: {
          const home = toolHomeOf(declarer);
          const key = toolGroupKey(home, declarer.server);
          let group = tools.get(key);
          if (group === undefined) {
            const transport = (await toolOf(home, declarer.server))?.transport;
            group = create(ToolValuesSchema, {
              pluginId: home.kind === "plugin" ? home.pluginId : "",
              agentId: home.kind === "agent" ? home.agentId : "",
              server: declarer.server,
              url: transport?.case === "http" ? transport.value.url : "",
            });
            tools.set(key, group);
            values.tools.push(group);
          }
          group.values[entry.key] = value;
          break;
        }
        case RunValueDeclarerKind.PLUGIN: {
          let group = plugins.get(declarer.pluginId);
          if (group === undefined) {
            group = create(PluginValuesSchema, { pluginId: declarer.pluginId });
            plugins.set(declarer.pluginId, group);
            values.plugins.push(group);
          }
          group.values[entry.key] = value;
          break;
        }
        case RunValueDeclarerKind.SUBAGENT: {
          // Before the default arm, which is the agent's: a subagent's key
          // never reaches the agent's shell.
          let group = subagents.get(declarer.name);
          if (group === undefined) {
            group = create(SubagentValuesSchema, { name: declarer.name });
            subagents.set(declarer.name, group);
            values.subagents.push(group);
          }
          group.values[entry.key] = value;
          break;
        }
        case RunValueDeclarerKind.REPOSITORY:
          values.repositories.push(
            create(RepositoryValuesSchema, {
              name: declarer.name,
              url: declarer.repositoryUrl,
              token: value,
            }),
          );
          break;
        default:
          values.agent[entry.key] = value;
      }
    }
    return values;
  }

  /** Opens a login and renews a sign-in once; a refused renewal names the address and the vault. */
  async function openLogin(
    entry: RunValueSource,
    vault: Vault,
    label: string,
    connection: SealedConnection,
    actor: CallerIdentity,
    retry: string,
  ): Promise<string> {
    const opened = await connection.open();
    if (opened.source !== VaultConnectionSource.sign_in) {
      return opened.token;
    }
    try {
      return await deps.freshener.freshToken(vault, opened, actor);
    } catch (error) {
      if (error instanceof ConnectError) {
        throw error;
      }
      if (error instanceof SignInRenewalError) {
        throw failedPreconditionError(
          `the sign-in for ${entry.entry} in ${label} could not be renewed: ${error.message}. Sign in again, then ${retry}`,
        );
      }
      throw internalError(error, `failed to renew the sign-in for ${entry.entry} in ${label}`);
    }
  }

  async function openRun(execution: Run): Promise<ExecutionValues> {
    const person = recordedRunPerson(execution);
    const stored = await storedSession(sessionIdOf(execution.spec));
    const own = openSessionValues(deps.secretService, stored);
    const entries = execution.status?.credentials?.sources ?? [];
    const values = await open(entries, {
      vaultFor: runScopeVaults(execution, stored, person),
      repositoryTokens: own.repositoryTokens,
      // A participant's turn records no person, yet someone asked: the
      // decrypt trail names its sender rather than the server.
      actor: serverActingFor(
        person ?? participantSenderOf(execution, stored) ?? "system",
      ),
      retry: "recover the turn",
    });
    logger.info("Opened run values", {
      executionId: execution.metadata?.id ?? "",
      entries: entries.length,
    });
    return values;
  }

  /** A listing's sources: the person's My vault, nothing else. */
  async function connectSources(input: ConnectPlanInput): Promise<Source[]> {
    if (input.person === undefined) {
      return [];
    }
    const mine = await deps.vaults.findMine(input.orgId, input.person);
    return mine === undefined
      ? []
      : [vaultSource("My vault", RunValueOrigin.MY_VAULT, mine)];
  }

  async function planConnect(input: ConnectPlanInput): Promise<RunValueSource[]> {
    const who: WhoActs =
      input.person !== undefined
        ? { kind: "person", includesMyVault: true, listsVaults: false }
        : { kind: "none" };
    return plan(toolRequirements(input.server), await connectSources(input), who);
  }

  async function openConnect(input: ConnectPlanInput): Promise<ExecutionValues> {
    const planned = await planConnect(input);
    const person = input.person;
    return open(planned, {
      vaultFor: async (entry) => {
        const mine = person === undefined ? undefined : await deps.vaults.findMine(input.orgId, person);
        return mine !== undefined && mine.metadata?.id === entry.vaultId
          ? { ok: true, vault: mine, label: "My vault" }
          : { ok: false, why: "My vault no longer exists" };
      },
      repositoryTokens: NO_REPOSITORY_TOKENS,
      actor: serverActingFor(person ?? "system"),
      retry: "list the tools again",
    });
  }

  return { planRun, openRun, planConnect, openConnect };
}
