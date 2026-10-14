/**
 * Every Managed Agents event type, at the pinned `@anthropic-ai/sdk`, is
 * either one the contract carries or one Stigmer never writes, and the docs
 * name every one it never writes (docs/sdk/managed-agents.mdx, "Where
 * Stigmer's events differ"), so a client written for Managed Agents learns
 * from the page which events never come instead of waiting for one.
 *
 * The SDK's stored-event union is the source, not its type-name list, which
 * omits `session.deleted`. `tsc` fails here when an SDK bump adds a type
 * neither list accounts for; the assertions fail when the contract starts
 * carrying a type still listed as never written, or the page stops naming
 * one.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { BetaManagedAgentsSessionEvent } from "@anthropic-ai/sdk/resources/beta/sessions/events";
import { describe, expect, it } from "vitest";

import { SESSION_EVENT_TYPES, isStigmerEventType } from "../catalog.js";

type ManagedAgentsEventType = BetaManagedAgentsSessionEvent["type"];

/** The Managed Agents types the contract carries. */
const WRITTEN = [
  "user.message",
  "user.interrupt",
  "user.tool_confirmation",
  "agent.message",
  "agent.thinking",
  "agent.tool_use",
  "agent.tool_result",
  "agent.mcp_tool_use",
  "agent.mcp_tool_result",
  "agent.thread_message_sent",
  "agent.thread_message_received",
  "agent.thread_context_compacted",
  "session.status_running",
  "session.status_idle",
  "session.error",
  "session.thread_created",
  "session.thread_status_running",
  "session.thread_status_idle",
] as const satisfies ReadonlyArray<ManagedAgentsEventType>;

/** The Managed Agents types Stigmer never writes, each named on the docs page. */
const NEVER_WRITTEN = [
  "agent.custom_tool_use",
  "user.custom_tool_result",
  "user.tool_result",
  "user.define_outcome",
  "system.message",
  "span.outcome_evaluation_start",
  "span.outcome_evaluation_ongoing",
  "span.outcome_evaluation_end",
  "session.status_rescheduled",
  "session.status_terminated",
  "session.thread_status_rescheduled",
  "session.thread_status_terminated",
  "session.updated",
  "session.deleted",
  "session.usage",
  "span.model_request_start",
  "span.model_request_end",
] as const satisfies ReadonlyArray<ManagedAgentsEventType>;

/** A type the SDK's union holds that neither list names; `never` while both account for every one. */
type Unaccounted = Exclude<ManagedAgentsEventType, (typeof WRITTEN)[number] | (typeof NEVER_WRITTEN)[number]>;
const everyTypeAccounted: [Unaccounted] extends [never] ? true : Unaccounted = true;

const here = dirname(fileURLToPath(import.meta.url));
const PAGE = join(here, "../../../../../../docs/sdk/managed-agents.mdx");
const HEADING = "## Where Stigmer's events differ";

/** The section of the page under the heading, up to the next heading of its level. */
function differSection(page: string): string {
  const start = page.indexOf(`\n${HEADING}\n`);
  if (start < 0) return "";
  const body = page.slice(start + HEADING.length + 2);
  const end = body.indexOf("\n## ");
  return end < 0 ? body : body.slice(0, end);
}

describe("Managed Agents event coverage at the pinned SDK", () => {
  it("accounts for every type of the SDK's stored-event union", () => {
    expect(everyTypeAccounted).toBe(true);
  });

  it("lists as written exactly the Managed Agents types the contract carries", () => {
    const carried = SESSION_EVENT_TYPES.filter((type) => !isStigmerEventType(type));
    expect([...carried].sort()).toEqual([...WRITTEN].sort());
  });

  it("never lists one type as both written and never written", () => {
    const written: ReadonlyArray<string> = WRITTEN;
    expect(NEVER_WRITTEN.filter((type) => written.includes(type))).toEqual([]);
  });

  it("names every type Stigmer never writes on the Managed Agents page", () => {
    const section = differSection(readFileSync(PAGE, "utf8"));
    expect(section, `${HEADING} is on docs/sdk/managed-agents.mdx`).not.toBe("");
    expect(NEVER_WRITTEN.filter((type) => !section.includes(`\`${type}\``))).toEqual([]);
  });
});
