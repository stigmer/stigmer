/**
 * The reader's quickstart project — the workspace the Getting Started
 * sequence keeps returning to. `create-agent-tour` (on create-agent.mdx)
 * edits and runs `ask-agent.ts`; the `connect-tools-tour` overview (on
 * connect-tools.mdx) edits the same file to add MCP servers and runs it
 * again. The reader is following one project across pages, so its identity
 * — folder name, entry file, file tree, terminal chrome — lives here once
 * and the embeds cannot drift apart.
 *
 * Depicted code listings stay tour-local: each tour shows a different
 * moment of `ask-agent.ts`, so the lines are the tour's story. Only the
 * identity and the shared "ask about an order" run output are common.
 *
 * Narrate-safe: type-only `@scenar/react` imports and plain data. Keep it
 * that way — no component imports, no CSS, no live clock.
 */
import type { FileTreeEntry, TerminalLine } from "@scenar/react";

/** The workspace's identity, as the editor and terminal shells frame it. */
export const QUICKSTART_WORKSPACE = {
  /** Folder name shown in the editor title bar and file explorer. */
  name: "stigmer-quickstart",
  /** The one script the sequence keeps editing and running. */
  entryFile: "ask-agent.ts",
  /** Terminal shell title for runs of the entry file. */
  terminalTitle: "Terminal — zsh",
  /** Working directory shown in the terminal prompt. */
  cwd: "~/stigmer-quickstart",
} as const;

/** File explorer contents — a deliberately minimal three-file project. */
export const QUICKSTART_FILE_TREE: readonly FileTreeEntry[] = [
  { name: QUICKSTART_WORKSPACE.entryFile, type: "file", depth: 0 },
  { name: "package.json", type: "file", depth: 0 },
  { name: "tsconfig.json", type: "file", depth: 0 },
];

/**
 * The payoff both tours share: running the entry file asks the agent about
 * order #ORD-4821 and real data comes back (via the Order Management API's
 * `get_order` — see `_shared/order-management-mcp.ts`).
 */
export const ORDER_LOOKUP_OUTPUT: readonly TerminalLine[] = [
  { type: "prompt", text: `npx tsx ${QUICKSTART_WORKSPACE.entryFile}` },
  { type: "blank", text: "" },
  { type: "output", text: "Order #ORD-4821 has been shipped." },
  { type: "blank", text: "" },
  { type: "output", text: "- Item: Wireless Headphones (1x $79.99)" },
  { type: "output", text: "- Tracking: 1Z999AA10123456784" },
  { type: "output", text: "- Estimated delivery: April 5, 2026" },
];
