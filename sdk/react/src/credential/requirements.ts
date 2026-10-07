/**
 * What a run of an agent needs, per declarer, and whether it has it: the
 * console's mirror of the server's resolver
 * (`backend/services/stigmer-server/src/domain/credential/resolve.ts`).
 *
 * A run's requirements are the keys its declarers declare, each with its
 * declarer: the agent's own `env` (which no longer carries its MCP
 * servers' keys), each MCP server the agent uses with its `env`, and the
 * git host of each workspace repository (`GITHUB_TOKEN`, optional). The
 * platform's own keys (`systemEnvVars.ts`) are never asked for.
 *
 * Two readings, one per kind of run:
 *
 * - A run with a person ({@link personReadiness}): a requirement is met by
 *   a value given for this run (by key), else by the default account. An
 *   MCP server with organization sign-in takes the organization's
 *   credential serving it; one with personal sign-in takes the person's
 *   own; an agent or a git host takes the person's own, then the
 *   organization's they can see (the list returns only those they may use).
 * - A run with no person ({@link assignmentReadiness}): a schedule, share
 *   link, channel or platform client takes only what is assigned on it, by
 *   declarer and key.
 *
 * Optional requirements never block a run; both readings report them
 * apart so a form can still offer them.
 *
 * Pinned by `__tests__/requirements.test.ts`.
 */
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { AgentSpec } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import type { Credential } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/api_pb";
import type { EnvVarDeclaration } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/requirement_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { McpServerSignIn } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb";
import type { CredentialAssignmentInput, Stigmer } from "@stigmer/sdk";
import {
  fromTargetInput,
  GIT_TOKEN_KEY,
  hasCredentialField,
  servingCredential,
  targetRefKey,
  type CredentialTargetRef,
} from "./model.js";
import { SYSTEM_ENV_VAR_KEYS } from "./systemEnvVars.js";

/** Whose account an MCP server's runs use. */
export type SignInScope = "personal" | "organization";

/** Who declares a requirement, with what a person reads for it. */
export interface Declarer {
  /** The declarer as a credential target. */
  readonly target: CredentialTargetRef;
  /** The name a person reads ("Linear", "PR reviewer", "github.com"). */
  readonly name: string;
  /** For an MCP server: whose account its runs use. */
  readonly signIn?: SignInScope;
  /** For an MCP server: its id, the key a sign-in completes under. */
  readonly mcpServerId?: string;
  /** For an MCP server that signs in by OAuth: the key the sign-in fills. */
  readonly signInKey?: string;
}

/** One value a declarer needs. */
export interface Requirement {
  readonly declarer: Declarer;
  readonly key: string;
  readonly isSecret: boolean;
  readonly optional: boolean;
  readonly description: string;
}

/** The comparable form of a requirement: its declarer's target and its key. */
export function requirementKey(requirement: Requirement): string {
  return `${targetRefKey(requirement.declarer.target)}#${requirement.key}`;
}

/** The scope of an MCP server's sign-in, as the resolver reads `spec.sign_in`. */
export function signInScopeOf(server: McpServer): SignInScope {
  return server.spec?.signIn === McpServerSignIn.organization ? "organization" : "personal";
}

/** The declarer an agent is. */
export function agentDeclarer(agent: Agent): Declarer {
  const org = agent.metadata?.org ?? "";
  const slug = agent.metadata?.slug ?? "";
  return {
    target: { kind: "agent", org, slug },
    name: agent.metadata?.name || slug,
  };
}

/** The declarer an MCP server is. */
export function mcpServerDeclarer(server: McpServer): Declarer {
  const org = server.metadata?.org ?? "";
  const slug = server.metadata?.slug ?? "";
  const signInKey = server.spec?.auth?.targetEnvVar ?? "";
  return {
    target: { kind: "mcp_server", org, slug },
    name: server.metadata?.name || slug,
    signIn: signInScopeOf(server),
    mcpServerId: server.metadata?.id ?? "",
    ...(signInKey !== "" ? { signInKey } : {}),
  };
}

/** The declarer a git host is. */
export function gitHostDeclarer(host: string): Declarer {
  const lower = host.toLowerCase();
  return { target: { kind: "git_host", host: lower }, name: lower };
}

/** The requirements a declarer's `env` declares, the platform's own keys left out. */
export function declaredRequirements(
  declarer: Declarer,
  env: { readonly [key: string]: Pick<EnvVarDeclaration, "isSecret" | "optional" | "description"> },
): Requirement[] {
  return Object.entries(env)
    .filter(([key]) => !SYSTEM_ENV_VAR_KEYS.has(key))
    .map(([key, declaration]) => ({
      declarer,
      key,
      isSecret: declaration.isSecret,
      optional: declaration.optional,
      description: declaration.description,
    }));
}

/** The requirement a workspace repository on `host` brings: its token, optional. */
export function gitHostRequirement(host: string): Requirement {
  return {
    declarer: gitHostDeclarer(host),
    key: GIT_TOKEN_KEY,
    isSecret: true,
    optional: true,
    description: `A token for cloning repositories from ${host.toLowerCase()}.`,
  };
}

/** A repository URL's host, lowercased; `undefined` for one that does not parse. */
export function gitHostOf(url: string): string | undefined {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "" ? undefined : host;
  } catch {
    return undefined;
  }
}

/** Options for {@link readRunRequirements}. */
export interface ReadRunRequirementsOptions {
  /** The spec the run will use; the agent's current spec when omitted. */
  readonly spec?: AgentSpec;
  /** Repository URLs the run's workspace clones; each host brings its token. */
  readonly repositoryUrls?: readonly string[];
  /**
   * What to do with an MCP server that cannot be read: `"throw"` (the
   * default) fails the read, `"skip"` leaves its requirements out, for a
   * hint that must never block the surface it advises.
   */
  readonly unreadableServer?: "throw" | "skip";
}

/** The requirements of a run of `agent`, and the MCP servers they came from. */
export interface RunRequirements {
  readonly requirements: Requirement[];
  readonly servers: McpServer[];
}

/**
 * Reads every requirement of a run of `agent`, per declarer, in the order
 * the agent names them: its own `env`, each MCP server it uses, each
 * repository host.
 */
export async function readRunRequirements(
  stigmer: Stigmer,
  agent: Agent,
  options?: ReadRunRequirementsOptions,
): Promise<RunRequirements> {
  const spec = options?.spec ?? agent.spec;
  const requirements: Requirement[] = [];
  const servers: McpServer[] = [];
  requirements.push(...declaredRequirements(agentDeclarer(agent), spec?.env ?? {}));
  for (const usage of spec?.mcpServerUsages ?? []) {
    const ref = usage.mcpServerRef;
    if (!ref || ref.slug === "") continue;
    let server: McpServer;
    try {
      server = await stigmer.mcpServer.getByReference({
        org: ref.org || agent.metadata?.org || "",
        slug: ref.slug,
      });
    } catch (err) {
      if (options?.unreadableServer === "skip") continue;
      throw err;
    }
    servers.push(server);
    requirements.push(...declaredRequirements(mcpServerDeclarer(server), server.spec?.env ?? {}));
  }
  const hosts = new Set<string>();
  for (const url of options?.repositoryUrls ?? []) {
    const host = gitHostOf(url);
    if (host === undefined || hosts.has(host)) continue;
    hosts.add(host);
    requirements.push(gitHostRequirement(host));
  }
  return { requirements, servers };
}

/** Where a person's run takes a met requirement from. */
export type PersonSource = "runtime" | "own" | "organization";

/** A person's run, read against what it would receive. */
export interface PersonReadiness {
  /** Requirements met, each with where its value comes from. */
  readonly met: ReadonlyArray<{ readonly requirement: Requirement; readonly source: PersonSource }>;
  /**
   * Required values the person can give: typed now, or saved into their
   * own credential serving the declarer.
   */
  readonly missing: readonly Requirement[];
  /**
   * Required values of an MCP server whose sign-in fills them: the person
   * signs in (personal sign-in) rather than types.
   */
  readonly signIns: readonly Requirement[];
  /**
   * Required values only the organization can give: an MCP server with
   * organization sign-in whose organization credential lacks them. An
   * admin signs the organization in or saves the value.
   */
  readonly organization: readonly Requirement[];
  /** Optional values nothing gives; they never block a run. */
  readonly optionalMissing: readonly Requirement[];
}

/** What a person's run is read against. */
export interface PersonReadinessInput {
  /** The credentials the person can see in the run's organization (the list RPC's answer). */
  readonly credentials: readonly Credential[];
  /** Keys given for this run (session variables, values typed for one run). */
  readonly runtimeKeys?: ReadonlySet<string>;
}

/**
 * Reads `requirements` the way the resolver would for a run with a person
 * (the module header). A sign-in key the person lacks is reported under
 * `signIns`, never `missing`, so a form never asks to type a token the
 * platform keeps fresh.
 */
export function personReadiness(
  requirements: readonly Requirement[],
  input: PersonReadinessInput,
): PersonReadiness {
  const met: Array<{ requirement: Requirement; source: PersonSource }> = [];
  const missing: Requirement[] = [];
  const signIns: Requirement[] = [];
  const organization: Requirement[] = [];
  const optionalMissing: Requirement[] = [];
  for (const requirement of requirements) {
    const source = personSourceFor(requirement, input);
    if (source !== undefined) {
      met.push({ requirement, source });
      continue;
    }
    if (requirement.optional) {
      optionalMissing.push(requirement);
      continue;
    }
    const declarer = requirement.declarer;
    if (declarer.target.kind === "mcp_server" && declarer.signIn === "organization") {
      organization.push(requirement);
    } else if (declarer.signInKey === requirement.key) {
      signIns.push(requirement);
    } else {
      missing.push(requirement);
    }
  }
  return { met, missing, signIns, organization, optionalMissing };
}

function personSourceFor(
  requirement: Requirement,
  input: PersonReadinessInput,
): PersonSource | undefined {
  if (input.runtimeKeys?.has(requirement.key)) return "runtime";
  const { target, signIn } = requirement.declarer;
  const holds = (credential: Credential | undefined): boolean =>
    credential !== undefined && hasCredentialField(credential, requirement.key);
  const own = servingCredential(input.credentials, target, "person");
  const org = servingCredential(input.credentials, target, "org");
  if (target.kind === "mcp_server") {
    if (signIn === "organization") return holds(org) ? "organization" : undefined;
    return holds(own) ? "own" : undefined;
  }
  if (holds(own)) return "own";
  return holds(org) ? "organization" : undefined;
}

/** A run with no person, read against what its surface assigns. */
export interface AssignmentReadiness {
  /** Required values with no assignment: the surface's runs are refused until each is assigned. */
  readonly unassigned: readonly Requirement[];
  /** Optional values with no assignment. */
  readonly optionalUnassigned: readonly Requirement[];
}

/** Whether `assignment` fills `requirement`: the same declarer, compared as a target, and key. */
export function assignmentFills(
  assignment: CredentialAssignmentInput,
  requirement: Requirement,
): boolean {
  const declarer = fromTargetInput(assignment.requirement.declarer);
  return (
    declarer !== undefined &&
    (assignment.requirement.key ?? "") === requirement.key &&
    targetRefKey(declarer) === targetRefKey(requirement.declarer.target)
  );
}

/** Reads `requirements` the way the resolver would for a run with no person. */
export function assignmentReadiness(
  requirements: readonly Requirement[],
  assignments: readonly CredentialAssignmentInput[],
): AssignmentReadiness {
  const unassigned: Requirement[] = [];
  const optionalUnassigned: Requirement[] = [];
  for (const requirement of requirements) {
    if (assignments.some((assignment) => assignmentFills(assignment, requirement))) continue;
    (requirement.optional ? optionalUnassigned : unassigned).push(requirement);
  }
  return { unassigned, optionalUnassigned };
}
