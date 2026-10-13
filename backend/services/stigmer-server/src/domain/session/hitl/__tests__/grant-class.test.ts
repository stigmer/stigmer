/**
 * Pins the class a grant allows (../answer.ts waitingInClass) for a call a
 * hook asked for: the lease is that hook's asks on that tool, so a hook's
 * grant allows only the open asks the same hook made on the same tool and
 * server, never a call the default asked for or another hook asked for; a
 * default grant never allows a call a hook asked for; and an ask whose
 * gate is closed, one the grant's read did not see, or one with no class
 * is never allowed. Driven over asks as the session's log states them,
 * the function the answer core calls.
 */
import { describe, expect, it } from "vitest";

import { deriveLeaseScope } from "../../../run/approval/lease-scope.js";
import { waitingInClass } from "../answer.js";
import type { LoggedAsk } from "../answer.js";

interface PendingAsk {
  readonly id: string;
  readonly name: string;
  readonly server?: string;
  readonly hook?: string;
  /** False for an ask whose asked event the log does not hold. */
  readonly asked?: boolean;
}

/** One ask per entry, by its id; a `hook` (even empty) marks a hook's ask, its absence the default's. */
function asksOf(asks: readonly PendingAsk[]): Map<string, LoggedAsk> {
  return new Map(
    asks.map((ask) => [
      ask.id,
      {
        toolUseId: ask.id,
        threadId: "",
        lease:
          ask.asked === false
            ? undefined
            : deriveLeaseScope({
                name: ask.name,
                mcpServer: ask.server ?? "",
                policySource:
                  ask.hook === undefined
                    ? ask.server === undefined
                      ? "builtin_category"
                      : "annotation_destructive_tighten"
                    : "hook",
                policyHook: ask.hook ?? "",
              }),
      },
    ]),
  );
}

function approvedBy(
  asks: ReadonlyMap<string, LoggedAsk>,
  clicked: string,
  closed: readonly string[] = [],
  unseen: readonly string[] = [],
): string[] {
  const lease = asks.get(clicked)!.lease!;
  const open = new Set([...asks.keys(), ...unseen].filter((id) => !closed.includes(id)));
  return waitingInClass(asks, clicked, lease, open).map((ask) => ask.toolUseId);
}

describe("the class a grant allows, with a hook's lease", () => {
  it("approves only the same hook's asks on the same tool and server", () => {
    const asks = asksOf([
      { id: "clicked", name: "execute", hook: "safety" },
      { id: "same", name: "execute", hook: "safety" },
      { id: "other-tool", name: "write_file", hook: "safety" },
      { id: "other-hook", name: "execute", hook: "audit" },
      { id: "agent-block", name: "execute", hook: "" },
      { id: "by-default", name: "execute" },
      {
        id: "mcp-same-name",
        name: "execute",
        server: "github",
        hook: "safety",
      },
    ]);
    expect(approvedBy(asks, "clicked")).toEqual(["same"]);
  });

  it("keeps an MCP tool's server in the scope", () => {
    const asks = asksOf([
      { id: "clicked", name: "create_issue", server: "github", hook: "safety" },
      { id: "same", name: "create_issue", server: "github", hook: "safety" },
      {
        id: "other-server",
        name: "create_issue",
        server: "gitlab",
        hook: "safety",
      },
      { id: "server-default", name: "delete_repo", server: "github" },
    ]);
    expect(approvedBy(asks, "clicked")).toEqual(["same"]);
  });

  it("never lets a default grant allow a call a hook asked for", () => {
    const asks = asksOf([
      { id: "clicked", name: "execute" },
      { id: "same-default", name: "execute" },
      { id: "hooked", name: "execute", hook: "safety" },
    ]);
    expect(approvedBy(asks, "clicked")).toEqual(["same-default"]);
  });

  it("never allows an ask whose gate is closed, one the read did not see, or one with no asked event", () => {
    const asks = asksOf([
      { id: "clicked", name: "shell" },
      { id: "answered", name: "shell" },
      { id: "no-asked-event", name: "shell", asked: false },
      { id: "waiting", name: "bash" },
    ]);
    expect(approvedBy(asks, "clicked", ["answered"], ["opened-since"])).toEqual(["waiting"]);
  });
});
