/**
 * The credential vocabulary the console reasons in, as pure functions:
 * who a credential belongs to, what it serves, and which of a list serves
 * a given agent, MCP server or git host.
 *
 * Targets are compared the way the server compares them
 * (`domain/credential/steps.ts`, `targetKey`): the kind and the absolute
 * reference (`org/slug`, the organization by id as stored resources name
 * it) or the lower-cased host. A console that builds its targets from a
 * resource's own metadata therefore matches exactly what a run resolves.
 *
 * The list RPC returns the caller's own credentials and the
 * organization's they may use, never another person's, so a credential
 * owned by a person in a list is the caller's own.
 *
 * Pinned by `__tests__/model.test.ts`.
 */
import type { Credential } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/api_pb";
import type { CredentialTarget } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/requirement_pb";
import { CredentialSource } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/status_pb";
import type { CredentialTargetInput } from "@stigmer/sdk";

/** The key a workspace repository's clone reads its token from. */
export const GIT_TOKEN_KEY = "GITHUB_TOKEN";

/** The git host the console's GitHub connection serves. */
export const GITHUB_HOST = "github.com";

/**
 * Something a credential's values are for, as the console names it: an
 * agent or an MCP server by its organization (an id) and slug, or a git
 * host by name.
 */
export type CredentialTargetRef =
  | { readonly kind: "agent"; readonly org: string; readonly slug: string }
  | { readonly kind: "mcp_server"; readonly org: string; readonly slug: string }
  | { readonly kind: "git_host"; readonly host: string };

/** Who a credential belongs to. */
export type CredentialOwnerKind = "person" | "org";

/** The comparable form of a target, equal to the server's `targetKey`. */
export function targetRefKey(ref: CredentialTargetRef): string {
  switch (ref.kind) {
    case "agent":
      return `agent:${ref.org}/${ref.slug}`;
    case "mcp_server":
      return `mcp_server:${ref.org}/${ref.slug}`;
    case "git_host":
      return `git_host:${ref.host.toLowerCase()}`;
    default: {
      const exhaustive: never = ref;
      throw new Error(`unknown credential target: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** A stored target as the console names it; `undefined` for an empty one. */
export function fromCredentialTarget(
  target: CredentialTarget,
): CredentialTargetRef | undefined {
  const t = target.target;
  switch (t.case) {
    case "agent":
      return { kind: "agent", org: t.value.org, slug: t.value.slug };
    case "mcpServer":
      return { kind: "mcp_server", org: t.value.org, slug: t.value.slug };
    case "gitHost":
      return { kind: "git_host", host: t.value };
    case undefined:
      return undefined;
    default: {
      const exhaustive: never = t;
      throw new Error(`unknown credential target: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** A target as the SDK's input types take it. */
export function toTargetInput(ref: CredentialTargetRef): CredentialTargetInput {
  switch (ref.kind) {
    case "agent":
      return { agent: { org: ref.org, slug: ref.slug } };
    case "mcp_server":
      return { mcpServer: { org: ref.org, slug: ref.slug } };
    case "git_host":
      return { gitHost: ref.host };
    default: {
      const exhaustive: never = ref;
      throw new Error(`unknown credential target: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** An SDK target input as the console names it; `undefined` for an empty one. */
export function fromTargetInput(
  input: CredentialTargetInput,
): CredentialTargetRef | undefined {
  if (input.agent) return { kind: "agent", org: input.agent.org, slug: input.agent.slug };
  if (input.mcpServer) {
    return { kind: "mcp_server", org: input.mcpServer.org, slug: input.mcpServer.slug };
  }
  if (input.gitHost) return { kind: "git_host", host: input.gitHost };
  return undefined;
}

/** Who a credential belongs to, or `undefined` when the owner is unset. */
export function credentialOwnerKind(
  credential: Credential,
): CredentialOwnerKind | undefined {
  const owner = credential.spec?.owner;
  switch (owner?.case) {
    case "person":
      return "person";
    case "org":
      return "org";
    case undefined:
      return undefined;
    default: {
      const exhaustive: never = owner;
      throw new Error(`unknown credential owner: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * Whether a listed credential is the caller's own. The list never returns
 * another person's credential, so a person-owned row is the caller's.
 */
export function isOwnCredential(credential: Credential): boolean {
  return credentialOwnerKind(credential) === "person";
}

/** Whether a credential belongs to the organization. */
export function isOrgCredential(credential: Credential): boolean {
  return credentialOwnerKind(credential) === "org";
}

/**
 * Whether a credential was saved by an MCP server sign-in: the platform
 * keeps its values fresh, so its fields cannot be set or removed by hand.
 */
export function isSignInCredential(credential: Credential): boolean {
  return credential.status?.source === CredentialSource.oauth;
}

/** The name a person reads for a credential. */
export function credentialDisplayName(credential: Credential): string {
  return credential.metadata?.name || credential.metadata?.slug || "Unnamed";
}

/** The names of a credential's fields, sorted. */
export function credentialFieldNames(credential: Credential): string[] {
  return Object.keys(credential.spec?.fields ?? {}).sort();
}

/** Whether a credential holds a field named `key`. */
export function hasCredentialField(credential: Credential, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(credential.spec?.fields ?? {}, key);
}

/** The targets a credential serves, as the console names them. */
export function servedTargets(credential: Credential): CredentialTargetRef[] {
  return (credential.spec?.serves ?? []).flatMap((target) => {
    const ref = fromCredentialTarget(target);
    return ref ? [ref] : [];
  });
}

/** Whether a credential serves `target`. */
export function servesTarget(credential: Credential, target: CredentialTargetRef): boolean {
  const wanted = targetRefKey(target);
  return servedTargets(credential).some((ref) => targetRefKey(ref) === wanted);
}

/**
 * The credential of `owner` that serves `target`, if any. At most one of a
 * person's and one of the organization's may serve a target, so the
 * answer is never a choice.
 */
export function servingCredential(
  credentials: readonly Credential[],
  target: CredentialTargetRef,
  owner: CredentialOwnerKind,
): Credential | undefined {
  return credentials.find(
    (credential) =>
      credentialOwnerKind(credential) === owner && servesTarget(credential, target),
  );
}

/** A target as a sentence names it ("the GitHub MCP server", "github.com"). */
export function targetWords(ref: CredentialTargetRef, name?: string): string {
  switch (ref.kind) {
    case "agent":
      return `agent ${name || ref.slug}`;
    case "mcp_server":
      return `MCP server ${name || ref.slug}`;
    case "git_host":
      return ref.host;
    default: {
      const exhaustive: never = ref;
      throw new Error(`unknown credential target: ${JSON.stringify(exhaustive)}`);
    }
  }
}
