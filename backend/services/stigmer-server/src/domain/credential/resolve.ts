/**
 * The one rule that decides which values a run receives.
 *
 * A run's requirements are the keys its declarers declare, each with its
 * declarer: the agent's own `env`, each MCP server the agent or the
 * session uses with its `env`, and the git host of each workspace
 * repository (`GITHUB_TOKEN`). For each requirement the first source that
 * has a value wins:
 *
 *   1. Per call: the run's `runtime_env`, by key.
 *   2. The surface: the credential assignment for this requirement on the
 *      schedule, share, channel or platform client that started a run with
 *      no person behind it. The assignment's writer must still be allowed
 *      to use its credential (`can_use`, asked again now); when they are
 *      not, the run is refused naming the assignment.
 *   3. The default account, for a run that has a person:
 *        - an MCP server with organization sign-in: the organization's
 *          credential serving the server, with no `can_use` check (the
 *          server's author said one account serves everyone);
 *        - an MCP server with personal sign-in: the person's own
 *          credential serving it;
 *        - an agent or a git host: the person's own credential serving it,
 *          then the organization's credential serving it when the person
 *          may use it. This is how a team key reaches a member's chat.
 *      A run with no person takes no default: what it needs is assigned
 *      on the surface that started it.
 *   4. Nothing: a required key refuses the run's create, naming the key
 *      and who must act; an optional key stays absent.
 *
 * Credentials are read in the run's organization only, so a person's
 * credentials in another organization never reach the run (an admin of a
 * parent organization acting in a child reaches none of theirs).
 *
 * Delivery is still one map by key (the runner's), so two requirements
 * with the same key must agree: when they resolve to different values the
 * create is refused naming both declarers, rather than one silently
 * winning. One sign-in that serves both the GitHub MCP server and
 * github.com is one value, not a conflict. A required key is missing only
 * when no requirement with that key resolved, because one delivered value
 * reaches every reader of the key.
 *
 * The values returned are PLAINTEXT, bound for the run's
 * ExecutionContext. They never appear in a log or an error.
 */
import { create } from "@bufbuild/protobuf";

import type { Credential } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/api_pb";
import type {
  CredentialAssignment,
  CredentialTarget,
  EnvVarDeclaration,
} from "@stigmer/protos/ai/stigmer/agentic/credential/v1/requirement_pb";
import { CredentialTargetSchema } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/requirement_pb";
import type { ExecutionValue } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/spec_pb";
import { ExecutionValueSchema } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/spec_pb";
import { McpServerSignIn } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type { Logger } from "../../boot/logger.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import { failedPreconditionError, internalError } from "../../pipeline/errors.js";
import { evaluateAuthorizer } from "../../pipeline/steps/authorize.js";
import type { Store } from "../../store/interface.js";
import { isSignIn, ownerOf, targetKey, targetWords } from "./steps.js";
import type { CredentialValues } from "./values.js";
import { credentialByReference, credentialsOfOrg } from "./values.js";

/** The key a workspace repository's clone reads its token from. */
export const GIT_TOKEN_KEY = "GITHUB_TOKEN";

/** Who declares a requirement. */
export type Declarer =
  | {
      readonly kind: "agent";
      readonly org: string;
      readonly slug: string;
    }
  | {
      readonly kind: "mcp_server";
      readonly id: string;
      readonly org: string;
      readonly slug: string;
      readonly signIn: McpServerSignIn;
    }
  | { readonly kind: "git_host"; readonly host: string };

/** One value a declarer needs. */
export interface Requirement {
  readonly declarer: Declarer;
  readonly key: string;
  readonly declaration: Pick<EnvVarDeclaration, "isSecret" | "optional">;
}

/** The surface that started a run with no person, and what it assigns. */
export interface RunSurface {
  /** How a refusal names the surface: "schedule", "share link", "channel", "platform client". */
  readonly noun: string;
  readonly id: string;
  readonly assignments: ReadonlyArray<CredentialAssignment>;
}

export interface ResolveInput {
  /** For logs only. */
  readonly runId: string;
  /** The run's organization; every credential is read there. */
  readonly org: string;
  /** The run's person (an identity account id); undefined for a run with no person. */
  readonly person: string | undefined;
  readonly runtimeEnv: { readonly [key: string]: ExecutionValue };
  /** The surface that started a run with no person; undefined otherwise. */
  readonly surface: RunSurface | undefined;
  readonly requirements: ReadonlyArray<Requirement>;
}

/**
 * Keeps a sign-in's access token fresh before a run reads it: the MCP
 * server domain's refresh (domain/mcpserver/oauth/sign-in.ts), answered
 * as the credential to read from (re-read after a refresh). Throws a
 * FailedPrecondition the run surfaces when the sign-in cannot be renewed.
 */
export interface SignInFreshener {
  freshen(credential: Credential): Promise<Credential>;
}

export interface CredentialResolverDeps {
  readonly store: Store;
  readonly logger: Logger;
  readonly authorizer: Authorizer;
  readonly values: CredentialValues;
  readonly signIns: SignInFreshener;
}

/** The target a declarer is, as credentials name it in `serves` and assignments. */
export function declarerTarget(declarer: Declarer): CredentialTarget {
  switch (declarer.kind) {
    case "agent":
      return create(CredentialTargetSchema, {
        target: {
          case: "agent",
          value: { kind: ApiResourceKind.agent, org: declarer.org, slug: declarer.slug },
        },
      });
    case "mcp_server":
      return create(CredentialTargetSchema, {
        target: {
          case: "mcpServer",
          value: {
            kind: ApiResourceKind.mcp_server,
            org: declarer.org,
            slug: declarer.slug,
          },
        },
      });
    case "git_host":
      return create(CredentialTargetSchema, {
        target: { case: "gitHost", value: declarer.host },
      });
    default: {
      const exhaustive: never = declarer;
      throw new Error(`unknown declarer: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** A value and where it came from, for the conflict rule. */
interface Resolved {
  readonly value: string;
  readonly isSecret: boolean;
  readonly declarer: string;
}

/**
 * Resolves every requirement of a run (the module header) into the one
 * delivery map, or refuses with FailedPrecondition.
 */
export async function resolveCredentials(
  deps: CredentialResolverDeps,
  input: ResolveInput,
): Promise<Map<string, ExecutionValue>> {
  let credentials: Credential[] | undefined;
  const orgCredentials = async (): Promise<Credential[]> => {
    if (credentials === undefined) {
      try {
        credentials = await credentialsOfOrg(deps.store, input.org);
      } catch (error) {
        throw internalError(error, "failed to read the organization's credentials");
      }
    }
    return credentials;
  };
  const freshened = new Map<string, Promise<Credential>>();
  // A sign-in is freshened once per run, whichever declarer reads it
  // first (one GitHub sign-in may serve the MCP server and github.com).
  const fresh = (credential: Credential): Promise<Credential> => {
    if (!isSignIn(credential)) {
      return Promise.resolve(credential);
    }
    const id = credential.metadata?.id ?? "";
    let held = freshened.get(id);
    if (held === undefined) {
      held = deps.signIns.freshen(credential);
      freshened.set(id, held);
    }
    return held;
  };

  const out = new Map<string, Resolved>();
  const missing = new Map<string, Requirement[]>();
  const refusals: string[] = [];

  for (const requirement of input.requirements) {
    const words = declarerWords(requirement.declarer);
    let found: string | undefined;

    // 1. Per call.
    const perCall = input.runtimeEnv[requirement.key];
    if (perCall !== undefined) {
      found = perCall.value;
    }

    // 2. The surface.
    if (found === undefined && input.surface !== undefined) {
      const assignment = assignmentFor(input.surface.assignments, requirement);
      if (assignment !== undefined) {
        const answer = await assignedValue(
          deps,
          input,
          await orgCredentials(),
          assignment,
          requirement,
          fresh,
        );
        if (answer.kind === "refused") {
          refusals.push(answer.reason);
          continue;
        }
        found = answer.value;
      }
    }

    // 3. The default account.
    if (found === undefined && input.person !== undefined) {
      found = await defaultValue(
        deps,
        input.person,
        await orgCredentials(),
        requirement,
        fresh,
      );
    }

    if (found === undefined) {
      const held = missing.get(requirement.key);
      if (held === undefined) {
        missing.set(requirement.key, [requirement]);
      } else {
        held.push(requirement);
      }
      continue;
    }

    const prior = out.get(requirement.key);
    if (prior !== undefined && prior.value !== found) {
      refusals.push(
        `${requirement.key} resolves to different values for ${prior.declarer} and ${words}; a run receives one value per key, so give both the same credential, or set ${requirement.key} for the run`,
      );
      continue;
    }
    if (prior === undefined) {
      out.set(requirement.key, {
        value: found,
        isSecret: requirement.declaration.isSecret,
        declarer: words,
      });
    }
  }

  for (const [key, needing] of missing) {
    if (out.has(key) || needing.every((r) => r.declaration.optional)) {
      continue;
    }
    const required = needing.filter((r) => !r.declaration.optional);
    refusals.push(missingValueReason(key, required, input));
  }

  if (refusals.length > 0) {
    throw failedPreconditionError(`this run cannot start: ${refusals.join("; ")}`);
  }

  deps.logger.info("Resolved the run's credentials", {
    runId: input.runId,
    keys: [...out.keys()].sort(),
    surface: input.surface?.noun ?? "",
    hasPerson: input.person !== undefined,
  });
  const values = new Map<string, ExecutionValue>();
  for (const [key, resolved] of out) {
    values.set(
      key,
      create(ExecutionValueSchema, { value: resolved.value, isSecret: resolved.isSecret }),
    );
  }
  return values;
}

/** The assignment for one requirement: its declarer and key, the declarer compared as a target. */
function assignmentFor(
  assignments: ReadonlyArray<CredentialAssignment>,
  requirement: Requirement,
): CredentialAssignment | undefined {
  const wanted = targetKey(declarerTarget(requirement.declarer));
  return assignments.find((assignment) => {
    const declarer = assignment.requirement?.declarer;
    return (
      declarer !== undefined &&
      assignment.requirement?.key === requirement.key &&
      targetKey(declarer) === wanted
    );
  });
}

type AssignedAnswer =
  | { readonly kind: "value"; readonly value: string | undefined }
  | { readonly kind: "refused"; readonly reason: string };

/**
 * The value an assignment gives: its literal, or its credential's field,
 * read only while the assignment's writer may still use the credential.
 * A credential or field that is gone is a refusal naming the assignment:
 * the surface's owner wrote it, and the run must not start without it.
 */
async function assignedValue(
  deps: CredentialResolverDeps,
  input: ResolveInput,
  credentials: ReadonlyArray<Credential>,
  assignment: CredentialAssignment,
  requirement: Requirement,
  fresh: (credential: Credential) => Promise<Credential>,
): Promise<AssignedAnswer> {
  const surface = input.surface;
  const where = surface === undefined ? "the surface" : `the ${surface.noun}`;
  const source = assignment.source;
  switch (source.case) {
    case "literal":
      return { kind: "value", value: source.value };
    case "credential": {
      const ref = source.value.credential;
      const slug = ref?.slug ?? "";
      const label = `${requirement.key} on ${where} (credential '${slug}')`;
      const credential =
        ref === undefined ? undefined : credentialByReference(credentials, ref);
      if (credential === undefined) {
        return {
          kind: "refused",
          reason: `the credential assigned for ${label} no longer exists in this organization`,
        };
      }
      if (assignment.writer !== "") {
        const allowed = await writerMayUse(deps, assignment.writer, credential);
        if (!allowed) {
          return {
            kind: "refused",
            reason: `whoever assigned ${label} may no longer use that credential; reassign it`,
          };
        }
      }
      const field = source.value.field === "" ? requirement.key : source.value.field;
      const read = await fresh(credential);
      const value = await deps.values.fieldValue(read, field);
      if (value === undefined) {
        return {
          kind: "refused",
          reason: `the credential assigned for ${label} has no field ${field}`,
        };
      }
      return { kind: "value", value };
    }
    case undefined:
      return { kind: "value", value: undefined };
    default: {
      const exhaustive: never = source;
      throw new Error(`unknown assignment source: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** Whether an assignment's writer may still use the credential (asked as that person, now). */
async function writerMayUse(
  deps: CredentialResolverDeps,
  writer: string,
  credential: Credential,
): Promise<boolean> {
  const decision = await evaluateAuthorizer(deps.authorizer, personCaller(writer), {
    permission: IamPermission.can_use,
    resourceKind: ApiResourceKind.credential,
    resourceId: credential.metadata?.id ?? "",
  });
  switch (decision.kind) {
    case "allow":
      return true;
    case "deny":
    case "not-found":
      return false;
    case "unavailable":
      throw internalError(decision.cause, "failed to check an assigned credential");
    default: {
      const exhaustive: never = decision;
      throw new Error(`unknown decision: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** A person asked about as themselves: a signed-in user with no token, from the server. */
function personCaller(identityId: string): CallerIdentity {
  return {
    identityId,
    callerClass: "user",
    issuer: "",
    rawToken: "",
    origin: "in-process",
  };
}

/** Step 3 of the module header for one requirement. */
async function defaultValue(
  deps: CredentialResolverDeps,
  person: string,
  credentials: ReadonlyArray<Credential>,
  requirement: Requirement,
  fresh: (credential: Credential) => Promise<Credential>,
): Promise<string | undefined> {
  const target = targetKey(declarerTarget(requirement.declarer));
  const serving = credentials.filter((credential) =>
    (credential.spec?.serves ?? []).some((t) => targetKey(t) === target),
  );
  const own = serving.find((credential) => {
    const owner = ownerOf(credential);
    return owner?.kind === "person" && owner.person === person;
  });
  const organizations = serving.find((credential) => ownerOf(credential)?.kind === "org");
  const read = async (credential: Credential | undefined): Promise<string | undefined> =>
    credential === undefined
      ? undefined
      : deps.values.fieldValue(await fresh(credential), requirement.key);

  const declarer = requirement.declarer;
  if (declarer.kind === "mcp_server") {
    return declarer.signIn === McpServerSignIn.organization
      ? read(organizations)
      : read(own);
  }
  const mine = await read(own);
  if (mine !== undefined) {
    return mine;
  }
  if (organizations === undefined) {
    return undefined;
  }
  return (await writerMayUse(deps, person, organizations)) ? read(organizations) : undefined;
}

/** A declarer as a refusal names it. */
function declarerWords(declarer: Declarer): string {
  return targetWords(declarerTarget(declarer));
}

/** The refusal for a required key nothing provided: the key, who needs it, who must act. */
function missingValueReason(
  key: string,
  needing: ReadonlyArray<Requirement>,
  input: ResolveInput,
): string {
  const who = needing.map((r) => declarerWords(r.declarer)).join(" and ");
  if (input.person === undefined) {
    const where =
      input.surface === undefined
        ? "the surface that started it"
        : `the ${input.surface.noun} that started it`;
    return `${who} needs ${key}, and a run with no person behind it uses only what is assigned on ${where}: assign ${key} there`;
  }
  const personal = needing.some(
    (r) =>
      r.declarer.kind === "mcp_server" &&
      r.declarer.signIn !== McpServerSignIn.organization,
  );
  const organization = needing.some(
    (r) =>
      r.declarer.kind === "mcp_server" &&
      r.declarer.signIn === McpServerSignIn.organization,
  );
  if (organization) {
    return `${who} needs ${key} from the organization's sign-in, and the organization has not signed in: an admin signs it in`;
  }
  if (personal) {
    return `${who} needs ${key}, and you have not signed in to it: sign in, or save a credential of yours that serves it`;
  }
  return `${who} needs ${key}: save a credential of yours that serves it, or ask an admin to let you use the organization's`;
}
