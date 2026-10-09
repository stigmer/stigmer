/**
 * The run's credential resolver: the one rule that decides which login or
 * secret fills each value a run needs, and refuses the run before it
 * starts when a required one is nowhere.
 *
 * What a run needs (requirements), each with its declarer:
 *   - every key its agent declares (`AgentSpec.env`);
 *   - every key each tool it uses declares (the agent's MCP servers and the
 *     session's own), and each tool's login key: `auth.target_env_var`,
 *     else the variable its `Authorization: Bearer ${VAR}` header names;
 *   - GITHUB_TOKEN for each github.com repository the session clones
 *     (optional: a public repository needs none). The runner sends that
 *     key only in an HTTPS URL whose host is github.com, so a repository
 *     on another host asks for nothing, and a token for another host never
 *     fills it.
 *
 * Where values come from, in order (the first source holding a match wins):
 *   1. a repository's own token, for its clone only;
 *   2. for a run with a person, when the stored session sets
 *      include_my_vault: that person's My vault;
 *   3. the session's vaults, in order;
 *   4. for a run with no person only, the vaults of the surface it came
 *      through, found from server-stamped facts: the minting platform
 *      client (the run's audit), its schedule (the run's
 *      stigmer.ai/schedule-id), its share or channel (the session's
 *      stigmer.ai/share-id or stigmer.ai/channel-id). A surface of another
 *      organization than the run's contributes nothing.
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
 * Every vault a run names is checked again when the run starts: `can_use`
 * for the run's person, or, for a run with no person, for the account
 * recorded as having attached it (the surface's `vault_attachers`). A
 * vault that is gone or no longer passes refuses the run, naming it and
 * the surface.
 *
 * Matching, per source: a login key by a connection at the tool's address
 * that was made for that tool, then, for an HTTP tool served over HTTPS
 * from GitHub's own API (GITHUB_API_HOSTS, default port), the github.com
 * connection, then a secret of that name; a clone by the
 * repository's own token, then a github.com connection, then a
 * GITHUB_TOKEN secret (a repository's own token is the one stored on the
 * entry of that name and URL, so a same-named repository on another host
 * never lends its token); any other key by a secret of its
 * name; a plain key falls back to its declaration's value. A connection is
 * made for a tool when its token goes where it was minted for: a sign-in
 * fills only the server whose id its sign-in record carries, while that
 * server is the kind (HTTP or a local program) the record says it was at
 * sign-in, and a pasted login only an HTTP tool whose own URL is that
 * address. A local program's
 * address is its login's discovery URL, which any definition may declare,
 * so it never takes a pasted login. Requirements sharing a key are
 * satisfied by whichever resolves; two different values for one key refuse
 * the run, naming both declarers, because one key can carry one value
 * until values are delivered per declarer.
 *
 * A login's token reaches only what it was made for, so a value that came
 * from a connection (pasted or a sign-in), or from a repository's own token
 * (which is for github.com, as the github.com login is), is shared only
 * when every requirement on its key is one the connection may serve: the
 * login of a tool it was made for (at its address); a github.com clone,
 * for the github.com connection; for that connection too, the login of an
 * HTTP tool on GitHub's own API (GITHUB_API_HOSTS: the GitHub tool and a
 * clone share GITHUB_TOKEN); and the agent's own declaration where the runner never
 * hands that key to the agent's shell (a tool of the run claims it, which
 * is how agent save copies its tools' keys, or a github.com clone already
 * put GITHUB_TOKEN there). Anything else refuses the run, naming the key,
 * the connection's address and the declarer that would receive it: a
 * Linear sign-in never reaches another tool that declares LINEAR_TOKEN,
 * and a repository's own token never reaches a tool on another host that
 * declares GITHUB_TOKEN. A value from a secret by name or a declaration
 * serves every declarer of its key.
 *
 * A sign-in's token is freshened once per run through the
 * SignInFreshener, which writes any renewal back to its vault, and only
 * after every requirement has been matched without a missing key, a
 * conflict or a login going elsewhere: a run that will be refused renews
 * nothing, and a run renews only the sign-ins whose values it carries. A
 * renewal the provider refuses (SignInRenewalError) refuses the run,
 * telling the person to sign in again; any other fault during renewal or
 * its write-back is INTERNAL.
 *
 * Nothing found for a required key refuses the create with
 * FAILED_PRECONDITION naming the key, its declarer and what the
 * conversation lacks; an optional key stays absent. A value reaches the
 * run only for a declared key.
 *
 * When the judging happens: once, at run create (and again on recover),
 * over the tool list and the tools' URLs as they are then. The runner reads
 * the agent's and the conversation's tool definitions again when the turn
 * starts, so an edit to a tool between create and the turn's start is not
 * judged here; delivering values per declarer, rather than one value per
 * key for the whole run, is what closes that window.
 *
 * The connect lane (resolveForConnect) has no conversation: it reads the
 * request's own values and then the caller's My vault only, and a sign-in
 * saved into a shared vault serves the runs that use that vault, never
 * connect.
 *
 * A vault's values are opened only when a requirement matches them
 * (VaultService.entries): matching reads which names and addresses a
 * vault holds, and which tool each sign-in was made for, from the sealed
 * row, and decrypts only the values chosen. A value the run does not need
 * is never decrypted, so one that cannot be opened refuses only the runs
 * that need it, and a run pays no decrypt for the rest of a large vault;
 * a needed one that cannot be opened refuses the run with its error.
 *
 * Every value is carried as secret (sealed in the context, redacted on its
 * reads) unless it is a plain declaration's own default: whatever came from
 * a vault, a connection, a sign-in or a repository's token is secret,
 * whatever its declaration says.
 *
 * Proven by __tests__/resolve.test.ts and the vault conformance suites.
 */
import { create } from "@bufbuild/protobuf";
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";
import { ConnectError } from "@connectrpc/connect";

import type { AgentSpec } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { AgentChannelSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import { AgentShareSchema } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/api_pb";
import type { ExecutionValue } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/spec_pb";
import { ExecutionValueSchema } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/spec_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { ScheduleSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { Vault } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import type { EnvVarDeclaration } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/declaration_pb";
import { VaultConnectionSource } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type { Logger } from "../../boot/logger.js";
import type { SecretService } from "../../encryption/encryption.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import { isFirstPartyHumanOperator } from "../../extensions/identity.js";
import { serverActingFor } from "../../pipeline/interceptors/auth.js";
import { failedPreconditionError, internalError } from "../../pipeline/errors.js";
import { evaluateAuthorizer } from "../../pipeline/steps/authorize.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import type { PlatformClientStore } from "../platformclient/store.js";

import { gitHostOf, toolAddressOf } from "./address.js";
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

/** The audit link a schedule stamps on every run it starts (temporal/schedule/run-starter.ts). */
export const SCHEDULE_ID_LABEL_KEY = "stigmer.ai/schedule-id";

/** The lineage a share link's guest session carries, stamped by the edition's guest lane. */
export const SHARE_ID_LABEL_KEY = "stigmer.ai/share-id";

/** The lineage a channel's session carries (domain/session/list-index.ts). */
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

/** Renews a sign-in's token when it has expired; implemented by the MCP server sign-in slice. */
export interface SignInFreshener {
  /**
   * The connection's usable access token: renewed first when expired and
   * a refresh token exists, the renewal written back to its vault. Throws
   * a SignInRenewalError naming the cause when the renewal itself fails.
   */
  freshToken(
    vault: Vault,
    connection: OpenedConnection,
    caller: CallerIdentity,
  ): Promise<string>;
}

/** Who declares a requirement, for the messages. */
export type Declarer =
  | { readonly kind: "agent"; readonly name: string }
  | { readonly kind: "tool"; readonly name: string }
  | { readonly kind: "repository"; readonly name: string };

/** One value a run needs. */
export interface Requirement {
  readonly key: string;
  readonly declarer: Declarer;
  readonly optional: boolean;
  readonly isSecret: boolean;
  /** A tool's login slot: matched by a connection at this address first. */
  readonly loginAddress?: string;
  /**
   * The tool behind a login slot: its id (a sign-in fills only the server
   * that made it) and whether it sends its login to its own address (an
   * HTTP server, whose address is its URL; only such a tool takes a
   * pasted login by address).
   */
  readonly tool?: { readonly id: string; readonly sendsToAddress: boolean };
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
  /**
   * A tool's key the runner keeps out of the agent's shell: one its env
   * declares, or its auth.target_env_var (the runner's declaredEnvKeysOf).
   * The agent's own declaration of such a key, which agent save copies
   * from its tools, reaches no shell.
   */
  readonly withheldFromShell?: boolean;
}

/** A source of values, in resolution order; a value is opened only once it matches. */
interface Source {
  /** Says where the value came from, in a conflict message ("the conversation's repositories", "vault 'Support tools'"). */
  readonly label: string;
  /** The vault row a sign-in's renewal writes back to. */
  readonly vault?: Vault;
  readonly secrets: ReadonlyMap<string, SealedValue>;
  readonly connections: ReadonlyMap<string, SealedConnection>;
  /** Keyed by repositoryTokenKey (name and URL). */
  readonly repositoryTokens?: ReadonlyMap<string, SealedValue>;
}

/** Whose turn it is to act when a required key is nowhere. */
type WhoActs =
  | { readonly kind: "person"; readonly includesMyVault: boolean; readonly listsVaults: boolean }
  | { readonly kind: "foreignAgent" }
  | { readonly kind: "surface"; readonly what: string }
  | { readonly kind: "none" };

export interface VaultResolverDeps {
  readonly store: Store;
  readonly logger: Logger;
  readonly authorizer: Authorizer;
  readonly secretService: SecretService;
  readonly vaults: VaultService;
  readonly platformClients: Pick<PlatformClientStore, "findById">;
  readonly freshener: SignInFreshener;
}

/** What a run brings to the resolver: the run, its session, its agent at the recorded version, every tool it uses. */
export interface RunCredentialInput {
  readonly execution: Run;
  readonly session: Session;
  readonly agentSpec: AgentSpec | undefined;
  readonly agentName: string;
  /**
   * The organization the agent belongs to, or undefined when its row
   * cannot be read. A run of another organization's agent (or an
   * unreadable one) reads no My vault, for any requirement.
   */
  readonly agentOrg: string | undefined;
  readonly tools: readonly McpServer[];
}

export interface VaultResolver {
  /** The values a run's context carries, keyed by environment variable. */
  resolveForRun(input: RunCredentialInput): Promise<Map<string, ExecutionValue>>;
  /**
   * What the MCP connect lane hands discovery: `ownValues` first, then the
   * caller's My vault for a first-party human caller, and nothing else. A
   * sign-in saved into a shared vault never satisfies connect; it serves
   * the runs that use that vault.
   */
  resolveForConnect(input: {
    readonly orgId: string;
    readonly caller: CallerIdentity;
    readonly server: McpServer;
    readonly ownValues: ReadonlyMap<string, ExecutionValue>;
  }): Promise<Map<string, ExecutionValue>>;
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

// ---------------------------------------------------------------------------
// Requirements
// ---------------------------------------------------------------------------

const BEARER_VARIABLE = /^\s*Bearer\s+\$\{([A-Za-z_][A-Za-z0-9_]*)\}\s*$/i;

/** A tool's login key: auth.target_env_var, else the variable its bearer header names. */
export function loginKeyOf(server: McpServer): string | undefined {
  const target = server.spec?.auth?.targetEnvVar ?? "";
  if (target !== "") {
    return target;
  }
  const serverType = server.spec?.serverType;
  if (serverType?.case !== "http") {
    return undefined;
  }
  for (const [header, value] of Object.entries(serverType.value.headers)) {
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

function nameOfTool(server: McpServer): string {
  return server.metadata?.name || server.metadata?.slug || server.metadata?.id || "a tool";
}

function declarationRequirements(
  env: { readonly [key: string]: EnvVarDeclaration },
  declarer: Declarer,
): Requirement[] {
  return Object.entries(env).map(([key, declaration]) => ({
    key,
    declarer,
    optional: declaration.optional,
    isSecret: declaration.isSecret,
    ...(declaration.isSecret || declaration.value === ""
      ? {}
      : { plainValue: declaration.value }),
  }));
}

/** Every requirement of a tool: its declarations, with its login key marked. */
export function toolRequirements(server: McpServer): Requirement[] {
  const declarer: Declarer = { kind: "tool", name: nameOfTool(server) };
  const loginKey = loginKeyOf(server);
  const address = toolAddressOf(server);
  const signIn = server.spec?.auth !== undefined;
  const tool = {
    id: server.metadata?.id ?? "",
    sendsToAddress: server.spec?.serverType?.case === "http",
  };
  const requirements = declarationRequirements(server.spec?.env ?? {}, declarer).map(
    (requirement): Requirement =>
      requirement.key === loginKey && address !== undefined
        ? {
            ...requirement,
            isSecret: true,
            loginAddress: address,
            tool,
            signIn,
            withheldFromShell: true,
          }
        : { ...requirement, withheldFromShell: true },
  );
  if (
    loginKey !== undefined &&
    !requirements.some((requirement) => requirement.key === loginKey)
  ) {
    requirements.push({
      key: loginKey,
      declarer,
      optional: false,
      isSecret: true,
      signIn,
      // A key only a Bearer header names is not one the runner withholds.
      withheldFromShell: (server.spec?.auth?.targetEnvVar ?? "") !== "",
      ...(address === undefined ? {} : { loginAddress: address, tool }),
    });
  }
  return requirements;
}

/** Every requirement of a run. */
export function runRequirements(input: RunCredentialInput): Requirement[] {
  const requirements: Requirement[] = [];
  if (input.agentSpec !== undefined) {
    requirements.push(
      ...declarationRequirements(input.agentSpec.env, {
        kind: "agent",
        name: input.agentName,
      }),
    );
  }
  for (const tool of input.tools) {
    requirements.push(...toolRequirements(tool));
  }
  for (const entry of input.session.spec?.workspaceEntries ?? []) {
    const source = entry.source?.source;
    if (source?.case !== "gitRepo" || gitHostOf(source.value.url) !== GITHUB_HOST) {
      continue;
    }
    requirements.push({
      key: CLONE_TOKEN_KEY,
      declarer: { kind: "repository", name: entry.name || source.value.url },
      optional: true,
      isSecret: true,
      clone: { entryName: entry.name, url: source.value.url },
    });
  }
  return requirements;
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

interface Found {
  readonly value: string;
  readonly source: Source;
  readonly connection?: OpenedConnection;
  /** The repository whose own token the value is (a clone's match): it goes only where the github.com login may. */
  readonly repository?: string;
  /** The declaration's own plain value: the one value carried as not secret. */
  readonly plain?: boolean;
}

/**
 * Whether a connection's token may fill a tool's login: a sign-in only for
 * the server that made it, while that server is still the kind it was at
 * sign-in (an HTTP server or a local program: a local program's address is
 * a discovery URL an editor may set to the old HTTP URL); a pasted login
 * only for an HTTP tool at its URL.
 */
function madeFor(
  connection: Pick<SealedConnection, "source" | "signIn">,
  tool: NonNullable<Requirement["tool"]>,
): boolean {
  if (connection.source === VaultConnectionSource.sign_in) {
    const minter = connection.signIn?.mcpServerId ?? "";
    const signedInAsLocalProgram = connection.signIn?.localProgram === true;
    // A tool with a login slot is an HTTP server or a local program.
    return (
      minter !== "" &&
      minter === tool.id &&
      signedInAsLocalProgram === !tool.sendsToAddress
    );
  }
  return tool.sendsToAddress;
}

/** Whether a login's address is an HTTPS URL on one of GitHub's own API hosts, at its default port. */
function onGitHubApi(address: string): boolean {
  const url = URL.canParse(address) ? new URL(address) : undefined;
  return url?.protocol === "https:" && url.port === "" && GITHUB_API_HOSTS.has(url.hostname);
}

/**
 * Whether a token for github.com (the github.com login, or a repository's
 * own token) or a connection's token for elsewhere (`github` false) may
 * reach a requirement that shares its key without having matched it (the
 * module header): a github.com clone or a tool on GitHub's own API for a
 * github.com token, or the agent's declaration of a key the runner keeps
 * out of the agent's shell.
 */
function mayServe(
  github: boolean,
  requirement: Requirement,
  sharing: readonly Requirement[],
): boolean {
  if (requirement.clone !== undefined) {
    return github;
  }
  if (requirement.loginAddress !== undefined && requirement.tool !== undefined) {
    // A login the connection was made for matched the connection itself,
    // so only GitHub's API remains to be served here.
    return github && requirement.tool.sendsToAddress && onGitHubApi(requirement.loginAddress);
  }
  if (requirement.declarer.kind === "agent") {
    // A key a tool of the run claims never reaches the shell; GITHUB_TOKEN
    // beside a github.com clone is there already, put by the clone.
    return (
      sharing.some((other) => other.withheldFromShell === true) ||
      (github &&
        requirement.key === CLONE_TOKEN_KEY &&
        sharing.some((other) => other.clone !== undefined))
    );
  }
  return false;
}

/** A matched login, opened: its token is the value. */
async function loginFound(connection: SealedConnection, source: Source): Promise<Found> {
  const opened = await connection.open();
  return { value: opened.token, source, connection: opened };
}

async function match(requirement: Requirement, sources: readonly Source[]): Promise<Found | undefined> {
  for (const source of sources) {
    if (requirement.clone !== undefined) {
      const own = source.repositoryTokens?.get(
        repositoryTokenKey(requirement.clone.entryName, requirement.clone.url),
      );
      if (own?.present === true) {
        return { value: await own.open(), source, repository: requirement.clone.entryName };
      }
      const connection = source.connections.get(GITHUB_HOST);
      if (connection?.present === true) {
        return loginFound(connection, source);
      }
      const secret = source.secrets.get(CLONE_TOKEN_KEY);
      if (secret?.present === true) {
        return { value: await secret.open(), source };
      }
      continue;
    }
    if (requirement.loginAddress !== undefined) {
      const connection = source.connections.get(requirement.loginAddress);
      if (
        connection?.present === true &&
        requirement.tool !== undefined &&
        madeFor(connection, requirement.tool)
      ) {
        return loginFound(connection, source);
      }
      if (
        requirement.tool?.sendsToAddress === true &&
        onGitHubApi(requirement.loginAddress)
      ) {
        const github = source.connections.get(GITHUB_HOST);
        if (github?.present === true) {
          return loginFound(github, source);
        }
      }
    }
    const secret = source.secrets.get(requirement.key);
    if (secret?.present === true) {
      return { value: await secret.open(), source };
    }
  }
  if (requirement.plainValue !== undefined) {
    return {
      value: requirement.plainValue,
      source: { label: "its declaration", secrets: new Map(), connections: new Map() },
      plain: true,
    };
  }
  return undefined;
}

/** How the messages name each kind of declarer. */
const DECLARER_WORDS: Readonly<Record<Declarer["kind"], (name: string) => string>> = {
  agent: (name) => `the agent ${name}`,
  tool: (name) => name,
  repository: (name) => `repository ${name}`,
};

function describeDeclarer(declarer: Declarer): string {
  return DECLARER_WORDS[declarer.kind](declarer.name);
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

/** How to take each kind of declarer out of a run, for the login refusal. */
const REMOVAL_WORDS: Readonly<Record<Declarer["kind"], (requirement: Requirement) => string>> = {
  agent: (requirement) => `remove ${requirement.key} from the env of the agent ${requirement.declarer.name}`,
  tool: (requirement) => `remove the tool ${requirement.declarer.name} from the agent or the conversation`,
  repository: (requirement) => `remove repository ${requirement.declarer.name} from the conversation`,
};

/** A login's token would reach a declarer it was not made for; never names the token. */
function loginElsewhereMessage(
  key: string,
  connection: OpenedConnection,
  source: Source,
  requirement: Requirement,
): string {
  const declarer = describeDeclarer(requirement.declarer);
  return (
    `${key} would carry the login for ${connection.address} in ${source.label} to ${declarer}, ` +
    "which that login is not for: a login goes only where it was made for, and one key carries one value for a run. " +
    `${REMOVAL_WORDS[requirement.declarer.kind](requirement)}, or, if ${declarer} should hold this value, ` +
    `save it as a secret named ${key} instead of a login: a secret by name serves every declarer of its key`
  );
}

/** A repository's own token would reach a declarer other than what a github.com token is for; never names the token. */
function repositoryTokenElsewhereMessage(
  key: string,
  repository: string,
  requirement: Requirement,
): string {
  const declarer = describeDeclarer(requirement.declarer);
  return (
    `${key} would carry repository ${repository}'s own token to ${declarer}, ` +
    "which that token is not for: it goes only to the clone, GitHub's own API and the agent beside the clone, and one key carries one value for a run. " +
    `${REMOVAL_WORDS[requirement.declarer.kind](requirement)}, or, if ${declarer} should hold this value, ` +
    `save it as a secret named ${key} instead of the repository's token: a secret by name serves every declarer of its key`
  );
}

// ---------------------------------------------------------------------------
// The resolver
// ---------------------------------------------------------------------------

/** A vault a run names, with what to say about it and whose permission to ask. */
interface NamedVault {
  readonly ref: ApiResourceReference;
  /** "this conversation", "schedule 'nightly'", for the messages. */
  readonly namedBy: string;
  /** Whose can_use to ask; undefined refuses (nobody recorded attaching it). */
  readonly principal: string | undefined;
  readonly fallbackOrgId: string;
}

function principalAsCaller(principal: string): CallerIdentity {
  return { identityId: principal, callerClass: "user", issuer: "", rawToken: "" };
}

/** A value already in plaintext, as a source holds one. */
function openedValue(value: string): SealedValue {
  return { present: value !== "", open: () => Promise.resolve(value) };
}

function vaultLabel(vault: Vault): string {
  return `vault '${vault.metadata?.name || vault.metadata?.slug || vault.metadata?.id || ""}'`;
}

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

  /** Loads, checks and opens the named vaults, in order. */
  async function openNamed(
    named: readonly NamedVault[],
    person: string | undefined,
  ): Promise<Source[]> {
    const sources: Source[] = [];
    const seen = new Set<string>();
    for (const entry of named) {
      const vault = await deps.vaults.findByReference(entry.ref, entry.fallbackOrgId);
      const refText = `${entry.ref.org || entry.fallbackOrgId}/${entry.ref.slug}`;
      if (vault === undefined) {
        throw failedPreconditionError(
          `vault ${refText}, named by ${entry.namedBy}, no longer exists: remove it from ${entry.namedBy} or create it again`,
        );
      }
      const id = vault.metadata?.id ?? "";
      if (seen.has(id)) {
        continue;
      }
      const owner = personOf(vault);
      if (owner !== undefined && owner !== person && entry.principal !== owner) {
        // A My vault reaches only its own person's runs, and a person-less
        // run only through its owner's own schedule.
        throw failedPreconditionError(
          `${vaultLabel(vault)}, named by ${entry.namedBy}, is someone's own My vault and serves only their runs`,
        );
      }
      const principal = entry.principal;
      const allowed = principal !== undefined && (await mayUse(principal, vault));
      if (!allowed) {
        throw failedPreconditionError(
          principal === undefined
            ? `${vaultLabel(vault)}, named by ${entry.namedBy}, has no record of who attached it: attach it again`
            : principal === person
              ? `${vaultLabel(vault)}, named by ${entry.namedBy}, is not one you may use: ask a vault admin for its use, or remove it from ${entry.namedBy}`
              : `${vaultLabel(vault)}, named by ${entry.namedBy}, may no longer be used by the account that attached it: ask a vault admin to grant it again, or attach another vault`,
        );
      }
      seen.add(id);
      sources.push(vaultSource(vaultLabel(vault), vault));
    }
    return sources;
  }

  /** A vault as a source: its entries, each opened only once it matches. */
  function vaultSource(label: string, vault: Vault): Source {
    const sealed = deps.vaults.entries(vault);
    return { label, vault, secrets: sealed.secrets, connections: sealed.connections };
  }

  /** A conversation's repository tokens: they match their own clone only. */
  function repositorySource(values: SessionOwnValues): Source {
    return {
      label: "the conversation's repositories",
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
    const surfaces: Array<{ what: string; refs: readonly ApiResourceReference[]; attachers: { readonly [id: string]: string }; org: string }> = [];

    const platformClientId =
      execution.status?.audit?.specAudit?.createdBy?.platformClientId ?? "";
    if (platformClientId !== "") {
      const client = await deps.platformClients.findById(platformClientId);
      if (client !== undefined && (client.metadata?.org ?? "") === executionOrg) {
        surfaces.push({
          what: `platform client '${client.metadata?.name ?? platformClientId}'`,
          refs: client.spec?.vaults ?? [],
          attachers: client.status?.vaultAttachers ?? {},
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
    const scheduleId = execution.metadata?.labels[SCHEDULE_ID_LABEL_KEY] ?? "";
    if (scheduleId !== "") {
      const schedule = await loadOptional(ApiResourceKind.schedule, scheduleId, ScheduleSchema);
      const target = schedule?.spec?.target;
      if (
        schedule !== undefined &&
        target?.case === "agent" &&
        sameOrganization("schedule", scheduleId, schedule.metadata?.org ?? "")
      ) {
        surfaces.push({
          what: `schedule '${schedule.metadata?.name ?? scheduleId}'`,
          refs: target.value.vaults,
          attachers: schedule.status?.vaultAttachers ?? {},
          org: executionOrg,
        });
      }
    }
    const shareId = session.metadata?.labels[SHARE_ID_LABEL_KEY] ?? "";
    if (shareId !== "") {
      const share = await loadOptional(ApiResourceKind.agent_share, shareId, AgentShareSchema);
      if (share !== undefined && sameOrganization("share", shareId, share.metadata?.org ?? "")) {
        surfaces.push({
          what: `share '${share.metadata?.name ?? shareId}'`,
          refs: share.spec?.vaults ?? [],
          attachers: share.status?.vaultAttachers ?? {},
          org: executionOrg,
        });
      }
    }
    const channelId = session.metadata?.labels[CHANNEL_ID_LABEL_KEY] ?? "";
    if (channelId !== "") {
      const channel = await loadOptional(ApiResourceKind.agent_channel, channelId, AgentChannelSchema);
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
    return { what: surfaces.map((surface) => surface.what).join(" and "), named };
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
   * Resolves requirements over sources; refuses on a conflict or a missing
   * required key before renewing anything, then renews the sign-ins whose
   * values the run carries.
   */
  async function settle(
    requirements: readonly Requirement[],
    sources: readonly Source[],
    who: WhoActs,
    actor: CallerIdentity,
  ): Promise<Map<string, ExecutionValue>> {
    const byKey = new Map<string, Requirement[]>();
    for (const requirement of requirements) {
      const list = byKey.get(requirement.key) ?? [];
      list.push(requirement);
      byKey.set(requirement.key, list);
    }
    const chosen: Array<{ key: string; found: Found; isSecret: boolean }> = [];
    const missing: string[] = [];
    for (const [key, sharing] of byKey) {
      const found: Array<{ requirement: Requirement; found: Found }> = [];
      for (const requirement of sharing) {
        const hit = await match(requirement, sources);
        if (hit !== undefined) {
          found.push({ requirement, found: hit });
        }
      }
      if (found.length === 0) {
        const required = sharing.find((requirement) => !requirement.optional);
        if (required !== undefined) {
          missing.push(missingMessage(required, who));
        }
        continue;
      }
      const distinct = new Map<string, (typeof found)[number]>();
      for (const hit of found) {
        if (!distinct.has(hit.found.value)) {
          distinct.set(hit.found.value, hit);
        }
      }
      if (distinct.size > 1) {
        const [first, second] = [...distinct.values()];
        throw failedPreconditionError(
          `${key} would carry two different values: ${describeDeclarer(first!.requirement.declarer)} gets one from ${first!.found.source.label} and ${describeDeclarer(second!.requirement.declarer)} another from ${second!.found.source.label}. One key carries one value for a run: keep one of them`,
        );
      }
      // The one value reaches every declarer of the key; a login's token
      // may reach only those the connection may serve.
      // A repository's own token is for github.com, as the github.com login is.
      const login = found.find((hit) => hit.found.connection !== undefined)?.found;
      const repositoryToken = found.find((hit) => hit.found.repository !== undefined)?.found;
      for (const requirement of sharing) {
        if (found.some((hit) => hit.requirement === requirement)) {
          continue;
        }
        if (
          login?.connection !== undefined &&
          !mayServe(login.connection.address === GITHUB_HOST, requirement, sharing)
        ) {
          throw failedPreconditionError(
            loginElsewhereMessage(key, login.connection, login.source, requirement),
          );
        }
        if (repositoryToken?.repository !== undefined && !mayServe(true, requirement, sharing)) {
          throw failedPreconditionError(
            repositoryTokenElsewhereMessage(key, repositoryToken.repository, requirement),
          );
        }
      }
      chosen.push({
        key,
        found: found[0]!.found,
        isSecret:
          sharing.some((requirement) => requirement.isSecret) ||
          found.some((hit) => hit.found.plain !== true),
      });
    }
    if (missing.length > 0) {
      throw failedPreconditionError(missing.join("; "));
    }
    const values = new Map<string, ExecutionValue>();
    // One match per key, and a sign-in fills only the tool it was made
    // for, so each sign-in is renewed at most once per run.
    for (const { key, found, isSecret } of chosen) {
      const fresh = await freshen(found, actor);
      values.set(key, create(ExecutionValueSchema, { value: fresh.value, isSecret }));
    }
    return values;
  }

  async function freshen(hit: Found, actor: CallerIdentity): Promise<Found> {
    const connection = hit.connection;
    const vault = hit.source.vault;
    if (
      connection === undefined ||
      vault === undefined ||
      connection.source !== VaultConnectionSource.sign_in
    ) {
      return hit;
    }
    let token: string;
    try {
      token = await deps.freshener.freshToken(vault, connection, actor);
    } catch (error) {
      if (error instanceof ConnectError) {
        throw error;
      }
      if (error instanceof SignInRenewalError) {
        throw failedPreconditionError(
          `the sign-in for ${connection.address} in ${hit.source.label} could not be renewed: ${error.message}. Sign in again`,
        );
      }
      throw internalError(
        error,
        `failed to renew the sign-in for ${connection.address} in ${hit.source.label}`,
      );
    }
    return { ...hit, value: token };
  }

  async function resolveForRun(input: RunCredentialInput): Promise<Map<string, ExecutionValue>> {
    const { execution, session } = input;
    const executionOrg = execution.metadata?.org ?? "";
    const person = recordedRunPerson(execution);
    const requirements = runRequirements(input);
    // The stored row, not the loader's copy: every read the session
    // controller answers shows the marker in place of a repository's
    // token, and only the row holds it sealed. A row that is gone refuses:
    // a copy's tokens and vault choice are nothing to run on.
    const sessionId = session.metadata?.id ?? "";
    let stored: Session;
    try {
      stored = await deps.store.getResource(ApiResourceKind.session, sessionId, SessionSchema);
    } catch (error) {
      if (error instanceof ResourceNotFoundError) {
        throw failedPreconditionError(
          `conversation ${sessionId} no longer exists: start a new conversation`,
        );
      }
      throw error;
    }
    const own = openSessionValues(deps.secretService, stored);
    const sessionRefs = stored.spec?.vaults ?? [];
    const includesMyVault = stored.spec?.includeMyVault === true;
    const sessionAttachers = stored.status?.vaultAttachers ?? {};

    const named: NamedVault[] = [];
    let who: WhoActs;
    for (const ref of sessionRefs) {
      let principal = person;
      if (principal === undefined) {
        const vault = await deps.vaults.findByReference(ref, executionOrg);
        principal = vault === undefined ? undefined : sessionAttachers[vault.metadata?.id ?? ""];
      }
      named.push({
        ref,
        namedBy: "this conversation",
        principal,
        fallbackOrgId: executionOrg,
      });
    }

    // A run of another organization's agent, or of one whose row cannot be
    // read: every value the run carries reaches that agent's code, so the
    // person's My vault stays closed to every requirement, its tools' and
    // its clones' included.
    const hasAgent = input.agentSpec !== undefined || input.agentName !== "";
    const foreignAgent =
      hasAgent && (input.agentOrg === undefined || input.agentOrg !== executionOrg);

    const sources: Source[] = [repositorySource(own)];
    if (person !== undefined) {
      who = foreignAgent
        ? { kind: "foreignAgent" }
        : { kind: "person", includesMyVault, listsVaults: sessionRefs.length > 0 };
      if (includesMyVault && !foreignAgent) {
        const mine = await deps.vaults.findMine(executionOrg, person);
        if (mine !== undefined) {
          sources.push(vaultSource("My vault", mine));
        }
      }
      sources.push(...(await openNamed(named, person)));
    } else {
      sources.push(...(await openNamed(named, undefined)));
      const surface = await surfaceOf(execution, session);
      who = surface === undefined ? { kind: "none" } : { kind: "surface", what: surface.what };
      if (surface !== undefined) {
        sources.push(...(await openNamed(surface.named, undefined)));
      }
    }

    const actor = serverActingFor(person ?? "system");
    const values = await settle(requirements, sources, who, actor);
    logger.info("Resolved run credentials", {
      executionId: execution.metadata?.id ?? "",
      hasPerson: person !== undefined,
      sources: sources.length,
      keys: values.size,
    });
    return values;
  }

  async function resolveForConnect(input: {
    readonly orgId: string;
    readonly caller: CallerIdentity;
    readonly server: McpServer;
    readonly ownValues: ReadonlyMap<string, ExecutionValue>;
  }): Promise<Map<string, ExecutionValue>> {
    const ownSecrets = new Map<string, SealedValue>();
    for (const [key, value] of input.ownValues) {
      ownSecrets.set(key, openedValue(value.value));
    }
    const sources: Source[] = [
      { label: "the request's own values", secrets: ownSecrets, connections: new Map() },
    ];
    const person = runPersonOfCaller(input.caller);
    if (person !== undefined) {
      const mine = await deps.vaults.findMine(input.orgId, person);
      if (mine !== undefined) {
        sources.push(vaultSource("My vault", mine));
      }
    }
    const who: WhoActs =
      person !== undefined
        ? { kind: "person", includesMyVault: true, listsVaults: false }
        : { kind: "none" };
    return settle(
      toolRequirements(input.server),
      sources,
      who,
      serverActingFor(person ?? "system"),
    );
  }

  return { resolveForRun, resolveForConnect };
}
