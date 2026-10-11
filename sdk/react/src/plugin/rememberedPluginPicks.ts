/**
 * The plugins a person last picked for a new conversation, remembered in
 * this browser per organization, so the next conversation starts with
 * them.
 *
 * A per-viewer convenience and nothing more: the picks live in
 * `localStorage`, never reach the server or another person, and any
 * failure (a private window, blocked storage, a value another version
 * wrote) reads as "nothing remembered" and writes nothing. A stored value
 * is trusted only as far as its shape: an array of `{ org, slug }` strings,
 * capped, anything else dropped. The server checks every reference a
 * conversation names when it is created, so a remembered plugin removed
 * since is refused there with the server's own message.
 */

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ResourceRef } from "@stigmer/sdk";

/** The `localStorage` key prefix; the organization's id follows it. */
export const PLUGIN_PICKS_STORAGE_KEY = "stigmer:plugins:last-picks:v1";

/** The most picks remembered: a conversation lists a handful. */
const MAX_PICKS = 20;

function keyFor(org: string): string {
  return `${PLUGIN_PICKS_STORAGE_KEY}:${org}`;
}

/** The picks remembered for `org`, oldest first; empty when none or unreadable. */
export function readRememberedPluginPicks(org: string): ResourceRef[] {
  if (org === "") return [];
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(keyFor(org));
  } catch {
    return [];
  }
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const picks: ResourceRef[] = [];
  for (const entry of parsed.slice(0, MAX_PICKS)) {
    const ref = narrowPick(entry);
    if (ref !== null) picks.push(ref);
  }
  return picks;
}

/** Remember `refs` as the last picks for `org`; an empty list forgets them. */
export function rememberPluginPicks(org: string, refs: readonly ResourceRef[]): void {
  if (org === "") return;
  try {
    if (refs.length === 0) {
      window.localStorage.removeItem(keyFor(org));
      return;
    }
    const stored = refs.slice(0, MAX_PICKS).map((ref) => ({ org: ref.org, slug: ref.slug }));
    window.localStorage.setItem(keyFor(org), JSON.stringify(stored));
  } catch {
    // Storage unavailable or full: the picks are simply not remembered.
  }
}

function narrowPick(entry: unknown): ResourceRef | null {
  if (typeof entry !== "object" || entry === null) return null;
  const org: unknown = Reflect.get(entry, "org");
  const slug: unknown = Reflect.get(entry, "slug");
  if (typeof org !== "string" || typeof slug !== "string" || slug === "") return null;
  return { org, slug, kind: ApiResourceKind.plugin };
}
