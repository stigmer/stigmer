/**
 * Pins the approval default (`shared/approval-policy.ts`): which calls ask —
 * the mutating built-in categories, the MCP tools their server marks
 * destructive, and every tool of a server whose tools could not be listed
 * this turn, nothing else — what a lease clears, the provenance each
 * verdict stamps (UNSPECIFIED for a call that needed none), the card
 * wording, the placeholder resolution with its secret redaction, the
 * derivation of leases from persisted decisions, the engine version, and
 * where the approval mode is read: the lane's fact on the status, with
 * anything but UNATTENDED asking.
 */

import { describe, it, expect } from "vitest";
import {
  buildMcpApprovalDefault,
  mcpToolKey,
  resolveApprovalMessage,
  resolveBuiltInApprovalMessage,
  deriveActiveLeases,
  hookLeaseKey,
  resolveApprovalProvenance,
  resolveToolApproval,
  toProtoPolicySource,
  POLICY_ENGINE_VERSION,
  isUnattendedApprovalMode,
  NOTHING_LISTED,
  UNLISTED_MCP_APPROVAL_MESSAGE,
  type ActiveLeases,
  type McpApprovalDefault,
} from "../approval-policy.js";
import type { ToolApprovalCategory } from "../tool-kind.js";
import type { McpToolListing } from "../mcp-tool-listing.js";
import { create } from "@bufbuild/protobuf";
import { RunSchema, type Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { ApprovalAction, ApprovalMode, ApprovalPolicySource } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";

/** No active leases. */
const NO_LEASES: ActiveLeases = { global: false, categories: new Set(), servers: new Set(), hooks: new Set() };

/** ActiveLeases with the given scopes; `global` defaults to false. */
function leases(opts: {
  global?: boolean;
  categories?: Array<"write" | "delete" | "shell">;
  servers?: string[];
}): ActiveLeases {
  return {
    global: opts.global ?? false,
    categories: new Set(opts.categories ?? []),
    servers: new Set(opts.servers ?? []),
    hooks: new Set(),
  };
}

/** A single tool call shaped just enough for deriveActiveLeases. */
interface TestToolCall {
  approvalAction: ApprovalAction;
  name?: string;
  mcpServerSlug?: string;
  approvalPolicySource?: ApprovalPolicySource;
  approvalPolicyHook?: string;
}

/**
 * Builds a minimal Run shaped just enough for deriveActiveLeases,
 * which reads each tool call's approval action plus its name / mcp_server_slug
 * (the scope inputs) on root and sub-agent messages, and spec.auto_approve_all.
 */
function makeExecution(opts: {
  rootCalls?: TestToolCall[];
  subAgentCalls?: TestToolCall[];
  autoApproveAll?: boolean;
  hasStatus?: boolean;
}): Run {
  const hasStatus = opts.hasStatus ?? true;
  const spec = { autoApproveAll: opts.autoApproveAll ?? false };
  if (!hasStatus) {
    return { spec, status: undefined } as unknown as Run;
  }
  const toCalls = (calls: TestToolCall[] = []) =>
    calls.map(c => ({
      approvalAction: c.approvalAction,
      name: c.name ?? "",
      mcpServerSlug: c.mcpServerSlug ?? "",
      approvalPolicySource: c.approvalPolicySource ?? ApprovalPolicySource.UNSPECIFIED,
      approvalPolicyHook: c.approvalPolicyHook ?? "",
    }));
  return {
    spec,
    status: {
      messages: [{ toolCalls: toCalls(opts.rootCalls) }],
      subAgentRuns: [
        { messages: [{ toolCalls: toCalls(opts.subAgentCalls) }] },
      ],
    },
  } as unknown as Run;
}

/** A turn's listing: each server's destructive tools, and the servers whose listing failed. */
function listingOf(destructive: Record<string, string[]>, unlisted: string[] = []): McpToolListing {
  return {
    listed: Object.entries(destructive).map(([server, tools]) => ({ server, tools })),
    destructive: Object.entries(destructive).flatMap(([server, tools]) => tools.map((tool) => ({ server, tool }))),
    unlisted,
  };
}

/** An approval default under which the given `server/tool` keys ask, and every tool of an `unlisted` server; `leasedServers` cleared. */
function mcpDefaultOf(destructive: string[] = [], leasedServers: string[] = [], unlisted: string[] = []): McpApprovalDefault {
  return { destructive: new Set(destructive), unlisted: new Set(unlisted), leasedServers: new Set(leasedServers) };
}

describe("buildMcpApprovalDefault", () => {
  it("keys each listed destructive tool by server and tool", () => {
    const d = buildMcpApprovalDefault(listingOf({ github: ["delete_repo"], db: ["drop_table", "truncate"] }), NO_LEASES);
    expect([...d.destructive].sort()).toEqual(["db/drop_table", "db/truncate", "github/delete_repo"]);
  });

  it("a same-named tool on two servers is destructive only where its own server says so", () => {
    const d = buildMcpApprovalDefault(listingOf({ a: ["delete"], b: [] }), NO_LEASES);
    expect(d.destructive.has(mcpToolKey("a", "delete"))).toBe(true);
    expect(d.destructive.has(mcpToolKey("b", "delete"))).toBe(false);
  });

  it("carries the servers whose listing failed, apart from the destructive marks", () => {
    const d = buildMcpApprovalDefault(listingOf({ github: [] }, ["plugin_linear_api"]), NO_LEASES);
    expect([...d.unlisted]).toEqual(["plugin_linear_api"]);
    expect(d.destructive.size).toBe(0);
  });

  it("carries the leased servers, and a server that marks nothing contributes nothing", () => {
    const d = buildMcpApprovalDefault(listingOf({ plain: [] }), leases({ servers: ["github"] }));
    expect(d.destructive.size).toBe(0);
    expect(d.unlisted.size).toBe(0);
    expect([...d.leasedServers]).toEqual(["github"]);
  });

  it("before anything is listed carries the leases alone", () => {
    const d = buildMcpApprovalDefault(NOTHING_LISTED, leases({ servers: ["github"] }));
    expect(d.destructive.size).toBe(0);
    expect(d.unlisted.size).toBe(0);
    expect([...d.leasedServers]).toEqual(["github"]);
  });
});

describe("deriveActiveLeases", () => {
  it("returns no leases when there is no status", () => {
    const result = deriveActiveLeases(makeExecution({ hasStatus: false }));
    expect(result.global).toBe(false);
    expect(result.categories.size).toBe(0);
    expect(result.servers.size).toBe(0);
  });

  it("returns no scoped leases when no tool call carries APPROVE_ALL", () => {
    const exec = makeExecution({
      rootCalls: [
        { approvalAction: ApprovalAction.APPROVE, name: "shell" },
        { approvalAction: ApprovalAction.SKIP, name: "write" },
      ],
      subAgentCalls: [{ approvalAction: ApprovalAction.REJECT, name: "delete" }],
    });
    const result = deriveActiveLeases(exec);
    expect(result.categories.size).toBe(0);
    expect(result.servers.size).toBe(0);
  });

  it("reflects the global pre-arm from spec.auto_approve_all", () => {
    const result = deriveActiveLeases(makeExecution({ autoApproveAll: true }));
    expect(result.global).toBe(true);
  });

  it("derives a built-in CATEGORY lease from an APPROVE_ALL on a built-in", () => {
    const exec = makeExecution({
      rootCalls: [{ approvalAction: ApprovalAction.APPROVE_ALL, name: "shell" }],
    });
    const result = deriveActiveLeases(exec);
    expect([...result.categories]).toEqual(["shell"]);
    expect(result.servers.size).toBe(0);
  });

  it("collapses FILE_WRITE and FILE_EDIT to a single 'write' category lease", () => {
    const exec = makeExecution({
      rootCalls: [
        { approvalAction: ApprovalAction.APPROVE_ALL, name: "write_file" },
        { approvalAction: ApprovalAction.APPROVE_ALL, name: "edit_file" },
      ],
    });
    expect([...deriveActiveLeases(exec).categories]).toEqual(["write"]);
  });

  it("derives a SERVER lease from an APPROVE_ALL on an MCP tool", () => {
    const exec = makeExecution({
      rootCalls: [
        { approvalAction: ApprovalAction.APPROVE_ALL, name: "create_issue", mcpServerSlug: "github" },
      ],
    });
    const result = deriveActiveLeases(exec);
    expect([...result.servers]).toEqual(["github"]);
    expect(result.categories.size).toBe(0);
  });

  it("derives leases from sub-agent tool calls too", () => {
    const exec = makeExecution({
      subAgentCalls: [
        { approvalAction: ApprovalAction.APPROVE_ALL, name: "delete" },
        { approvalAction: ApprovalAction.APPROVE_ALL, name: "drop", mcpServerSlug: "database" },
      ],
    });
    const result = deriveActiveLeases(exec);
    expect([...result.categories]).toEqual(["delete"]);
    expect([...result.servers]).toEqual(["database"]);
  });

  it("derives a HOOK lease, and only that, from an APPROVE_ALL on a call a hook asked about", () => {
    const exec = makeExecution({
      rootCalls: [
        {
          approvalAction: ApprovalAction.APPROVE_ALL,
          name: "execute",
          approvalPolicySource: ApprovalPolicySource.HOOK,
          approvalPolicyHook: "safety",
        },
        {
          approvalAction: ApprovalAction.APPROVE_ALL,
          name: "create_issue",
          mcpServerSlug: "github",
          approvalPolicySource: ApprovalPolicySource.HOOK,
          approvalPolicyHook: "",
        },
      ],
    });
    const result = deriveActiveLeases(exec);
    expect([...result.hooks]).toEqual([hookLeaseKey("safety", "", "execute"), hookLeaseKey("", "github", "create_issue")]);
    expect(result.categories.size).toBe(0);
    expect(result.servers.size).toBe(0);
  });

  it("does not lease a read-only built-in (no category) on APPROVE_ALL", () => {
    const exec = makeExecution({
      rootCalls: [{ approvalAction: ApprovalAction.APPROVE_ALL, name: "read" }],
    });
    const result = deriveActiveLeases(exec);
    expect(result.categories.size).toBe(0);
    expect(result.servers.size).toBe(0);
  });
});

describe("resolveApprovalMessage", () => {
  it("resolves {{tool_name}} placeholder", () => {
    expect(resolveApprovalMessage(
      "Execute {{tool_name}}?",
      "create_issue",
      {},
    )).toBe("Execute create_issue?");
  });

  it("resolves {{args.field}} placeholders", () => {
    expect(resolveApprovalMessage(
      "Create issue '{{args.title}}' in {{args.repo}}?",
      "create_issue",
      { title: "Bug fix", repo: "org/repo" },
    )).toBe("Create issue 'Bug fix' in org/repo?");
  });

  it("shows <unknown> for missing args", () => {
    expect(resolveApprovalMessage(
      "Delete {{args.name}}?",
      "delete",
      {},
    )).toBe("Delete <unknown>?");
  });

  it("JSON-stringifies non-string arg values", () => {
    expect(resolveApprovalMessage(
      "Set {{args.count}}",
      "set",
      { count: 42 },
    )).toBe("Set 42");
  });

  // stigmer#1119: the message is stored on the row and shown on the approval
  // card, so a secret-keyed placeholder never resolves to the secret.
  it("redacts a secret-keyed placeholder, whatever the key's case, and keeps the rest", () => {
    expect(resolveApprovalMessage(
      "Push to {{args.repo}} with {{args.token}} ({{args.Api_Key}})?",
      "push",
      { repo: "acme/x", token: "s3cret", Api_Key: "sk-123" },
    )).toBe("Push to acme/x with [REDACTED] ([REDACTED])?");
  });

  it("handles null arg values", () => {
    expect(resolveApprovalMessage(
      "Value: {{args.val}}",
      "test",
      { val: null },
    )).toBe("Value: <unknown>");
  });

  it("returns template unchanged when no placeholders", () => {
    expect(resolveApprovalMessage("Simple message", "tool", {}))
      .toBe("Simple message");
  });
});

// ---------------------------------------------------------------------------
// resolveApprovalProvenance — the read-side seam that stamps
// ToolCall.approval_policy_source.
// ---------------------------------------------------------------------------

describe("resolveApprovalProvenance", () => {
  const NO_CATEGORIES: ReadonlySet<ToolApprovalCategory> = new Set();
  const githubDeletes = mcpDefaultOf(["github/delete_repo"]);

  it("returns auto_approve_all when the whole-run global bypass is armed", () => {
    expect(resolveApprovalProvenance("delete_repo", "github", githubDeletes, NO_CATEGORIES, true)).toBe("auto_approve_all");
    expect(resolveApprovalProvenance("execute", "", mcpDefaultOf(), NO_CATEGORIES, true)).toBe("auto_approve_all");
  });

  it("reads annotation_destructive_tighten for an MCP tool its server marks destructive", () => {
    expect(resolveApprovalProvenance("delete_repo", "github", githubDeletes, NO_CATEGORIES, false)).toBe(
      "annotation_destructive_tighten",
    );
  });

  it("reads undefined for an MCP tool its server does not mark destructive: it needed no approval", () => {
    expect(resolveApprovalProvenance("list_issues", "github", githubDeletes, NO_CATEGORIES, false)).toBeUndefined();
  });

  it("reads approval_lease for any tool of a leased server, destructive or not", () => {
    const leased = mcpDefaultOf(["github/delete_repo"], ["github"]);
    expect(resolveApprovalProvenance("delete_repo", "github", leased, NO_CATEGORIES, false)).toBe("approval_lease");
    expect(resolveApprovalProvenance("list_issues", "github", leased, NO_CATEGORIES, false)).toBe("approval_lease");
  });

  it("reads annotation_destructive_tighten for any tool of a server whose listing failed, and approval_lease once it is leased", () => {
    expect(resolveApprovalProvenance("anything", "linear", mcpDefaultOf([], [], ["linear"]), NO_CATEGORIES, false)).toBe(
      "annotation_destructive_tighten",
    );
    expect(resolveApprovalProvenance("anything", "linear", mcpDefaultOf([], ["linear"], ["linear"]), NO_CATEGORIES, false)).toBe(
      "approval_lease",
    );
  });

  it("returns builtin_category for a mutating built-in with no lease", () => {
    expect(resolveApprovalProvenance("write", "", mcpDefaultOf(), NO_CATEGORIES, false)).toBe("builtin_category");
  });

  it("returns approval_lease for a mutating built-in whose category is leased", () => {
    expect(
      resolveApprovalProvenance("write", "", mcpDefaultOf(), new Set<ToolApprovalCategory>(["write"]), false),
    ).toBe("approval_lease");
  });

  it("returns undefined for a read-only built-in", () => {
    expect(resolveApprovalProvenance("read", "", mcpDefaultOf(), NO_CATEGORIES, false)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// toProtoPolicySource — the runner-union -> proto-enum mapping. The
// cross-edition corpus (policy-source-corpus.test.ts) pins the numbers; these
// cases assert the mapping is total and that undefined collapses to UNSPECIFIED.
// ---------------------------------------------------------------------------

describe("resolveToolApproval — THE gate decision, shared by the gate and the translators", () => {
  const NO_CATEGORIES: ReadonlySet<ToolApprovalCategory> = new Set();
  const githubDeletes = mcpDefaultOf(["github/delete_repo"]);

  it("an MCP tool its server marks destructive waits, worded `Execute <tool>`, source annotation_destructive_tighten", () => {
    expect(resolveToolApproval("delete_repo", "github", { repo: "x" }, githubDeletes, NO_CATEGORIES)).toEqual({
      requiresApproval: true,
      message: "Execute delete_repo",
      source: "annotation_destructive_tighten",
    });
  });

  it("any other MCP tool runs with no source: nothing asks for it", () => {
    expect(resolveToolApproval("list_issues", "github", {}, githubDeletes, NO_CATEGORIES)).toEqual({
      requiresApproval: false,
      message: "",
      source: undefined,
    });
  });

  it("the destructive mark is the server's own: a same-named tool on another server runs", () => {
    expect(resolveToolApproval("delete_repo", "gitlab", {}, githubDeletes, NO_CATEGORIES).requiresApproval).toBe(false);
  });

  it("a leased server's tool runs, destructive or not, source approval_lease", () => {
    const leased = mcpDefaultOf(["github/delete_repo"], ["github"]);
    expect(resolveToolApproval("delete_repo", "github", {}, leased, NO_CATEGORIES)).toEqual({
      requiresApproval: false,
      message: "",
      source: "approval_lease",
    });
  });

  it("every tool of a server whose tools could not be listed waits, worded so, on that server only", () => {
    const unlisted = mcpDefaultOf([], [], ["linear"]);
    expect(resolveToolApproval("list_issues", "linear", {}, unlisted, NO_CATEGORIES)).toEqual({
      requiresApproval: true,
      message: UNLISTED_MCP_APPROVAL_MESSAGE.replace("{{tool_name}}", "list_issues"),
      source: "annotation_destructive_tighten",
    });
    expect(resolveToolApproval("list_issues", "github", {}, unlisted, NO_CATEGORIES).requiresApproval).toBe(false);
  });

  it("a lease clears a server whose tools could not be listed", () => {
    expect(resolveToolApproval("list_issues", "linear", {}, mcpDefaultOf([], ["linear"], ["linear"]), NO_CATEGORIES)).toEqual({
      requiresApproval: false,
      message: "",
      source: "approval_lease",
    });
  });

  it("a mutating built-in waits with its category's message (fail-closed), source builtin_category", () => {
    expect(resolveToolApproval("execute", "", { command: "rm -rf build" }, mcpDefaultOf(), NO_CATEGORIES)).toEqual({
      requiresApproval: true,
      message: "Run command: rm -rf build",
      source: "builtin_category",
    });
  });

  it("a gated native file write waits with the file named on its card (#1112)", () => {
    expect(
      resolveToolApproval("write_file", "", { file_path: "/workspace/src/app.ts", content: "x" }, mcpDefaultOf(), NO_CATEGORIES),
    ).toEqual({
      requiresApproval: true,
      message: "Write file: /workspace/src/app.ts",
      source: "builtin_category",
    });
  });

  it("a mutating built-in whose category is leased runs, source approval_lease", () => {
    expect(
      resolveToolApproval("execute", "", { command: "ls" }, mcpDefaultOf(), new Set<ToolApprovalCategory>(["shell"])),
    ).toEqual({
      requiresApproval: false,
      message: "",
      source: "approval_lease",
    });
  });

  it("a read-only or unclassified built-in runs (fail-open)", () => {
    expect(resolveToolApproval("read_file", "", { path: "/x" }, mcpDefaultOf(), NO_CATEGORIES).requiresApproval).toBe(false);
    expect(resolveToolApproval("think", "", {}, mcpDefaultOf(), NO_CATEGORIES).requiresApproval).toBe(false);
  });
});

describe("resolveBuiltInApprovalMessage — the one card wording for a gated built-in, either harness", () => {
  it("names the file a native write or edit touches: deepagents' file tools send file_path (#1112)", () => {
    expect(resolveBuiltInApprovalMessage("write_file", { file_path: "/workspace/src/app.ts", content: "x" })).toBe("Write file: /workspace/src/app.ts");
    expect(resolveBuiltInApprovalMessage("edit_file", { file_path: "/workspace/README.md", old_string: "a", new_string: "b" })).toBe("Write file: /workspace/README.md");
  });

  it("names the file from path in the Cursor stream's taxonomy, and from file_path in its hook's", () => {
    expect(resolveBuiltInApprovalMessage("edit", { path: "src/app.ts" })).toBe("Write file: src/app.ts");
    expect(resolveBuiltInApprovalMessage("Write", { file_path: "src/app.ts" })).toBe("Write file: src/app.ts");
    expect(resolveBuiltInApprovalMessage("Delete", { file_path: "old.txt" })).toBe("Delete: old.txt");
    expect(resolveBuiltInApprovalMessage("delete", { path: "old.txt" })).toBe("Delete: old.txt");
  });

  it("prefers path when a call carries both names", () => {
    expect(resolveBuiltInApprovalMessage("write_file", { path: "a.txt", file_path: "b.txt" })).toBe("Write file: a.txt");
  });

  it("still reads <unknown> when a file call names no file at all", () => {
    expect(resolveBuiltInApprovalMessage("write_file", { content: "x" })).toBe("Write file: <unknown>");
  });

  it("words a shell card from the command, in either taxonomy", () => {
    expect(resolveBuiltInApprovalMessage("execute", { command: "rm -rf build" })).toBe("Run command: rm -rf build");
    expect(resolveBuiltInApprovalMessage("Shell", { command: "ls" })).toBe("Run command: ls");
  });

  it("answers undefined for a built-in that is not gated", () => {
    expect(resolveBuiltInApprovalMessage("read_file", { file_path: "/x" })).toBeUndefined();
    expect(resolveBuiltInApprovalMessage("Read", { file_path: "/x" })).toBeUndefined();
  });
});

describe("toProtoPolicySource", () => {
  it("maps undefined (no approval needed) to UNSPECIFIED", () => {
    expect(toProtoPolicySource(undefined)).toBe(ApprovalPolicySource.UNSPECIFIED);
  });

  it("maps every persisted union member to a distinct non-UNSPECIFIED enum value", () => {
    const sources = [
      "auto_approve_all",
      "approval_lease",
      "builtin_category",
      "annotation_destructive_tighten",
      "unattended_skip",
      "hook",
    ] as const;
    const mapped = sources.map((s) => toProtoPolicySource(s));
    expect(mapped.every((v) => v !== ApprovalPolicySource.UNSPECIFIED)).toBe(true);
    expect(new Set(mapped).size).toBe(sources.length);
  });

  it("maps file_capture, an audit-only source, to UNSPECIFIED", () => {
    expect(toProtoPolicySource("file_capture")).toBe(ApprovalPolicySource.UNSPECIFIED);
  });
});

describe("POLICY_ENGINE_VERSION", () => {
  it("is hooks-1: an agent's hooks answer before the default", () => {
    expect(POLICY_ENGINE_VERSION).toBe("hooks-1");
  });
});

describe("hookLeaseKey", () => {
  it("keeps the hook, the server and the tool apart, whatever their spelling", () => {
    expect(hookLeaseKey("a", "b/c", "d")).not.toBe(hookLeaseKey("a/b", "c", "d"));
  });
});

describe("isUnattendedApprovalMode", () => {
  const withMode = (approvalMode: ApprovalMode | undefined): Run =>
    create(RunSchema, {
      spec: { message: "hi" },
      ...(approvalMode === undefined ? {} : { status: { approvalMode } }),
    });

  it("reads UNATTENDED from the status the control plane stamped", () => {
    expect(isUnattendedApprovalMode(withMode(ApprovalMode.UNATTENDED))).toBe(true);
  });

  it("asks on INTERACTIVE", () => {
    expect(isUnattendedApprovalMode(withMode(ApprovalMode.INTERACTIVE))).toBe(false);
  });

  it("asks on UNSPECIFIED and on a record with no status: the safe default is the one that pauses", () => {
    expect(isUnattendedApprovalMode(withMode(ApprovalMode.UNSPECIFIED))).toBe(false);
    expect(isUnattendedApprovalMode(withMode(undefined))).toBe(false);
  });
});
