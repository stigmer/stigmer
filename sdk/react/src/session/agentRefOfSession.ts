/**
 * The agent a session names, as the console's pickers and setup panels
 * hold an agent: organization and slug, no version.
 *
 * A session names its agent directly (`spec.agentRef`), so the reference
 * is read, never fetched. The version is left out on purpose: what a
 * conversation runs is the version the server pinned on
 * `status.agentVersionHash`, and a reference the console writes back
 * without a version keeps that pin (see `useSessionConversation`). Two
 * references name the same agent when organization and slug match; an
 * organization named by slug in one and by id in the other reads as a
 * different agent here, and the server, which normalizes both, treats a
 * write of it as an echo that keeps the pin.
 *
 * Pinned by `__tests__/agentRefOfSession.test.ts`.
 */

import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ResourceRef } from "@stigmer/sdk";

/**
 * The agent `session` names, or `null` when it names none (the built-in
 * assistant) or has not loaded.
 */
export function agentRefOfSession(
  session: Pick<Session, "spec"> | null | undefined,
): ResourceRef | null {
  const ref = session?.spec?.agentRef;
  if (ref === undefined || ref.slug === "") return null;
  return { org: ref.org, slug: ref.slug, kind: ApiResourceKind.agent };
}

/** Whether two references name the same agent (organization and slug). */
export function isSameAgent(
  a: ResourceRef | null | undefined,
  b: ResourceRef | null | undefined,
): boolean {
  if (!a || !b) return a == null && b == null;
  return a.org === b.org && a.slug === b.slug;
}
