// The remember tool — the ONE tool of the memory roster (DD-005 D1: the
// first-party capture verb both harnesses receive through the
// runner-synthesized memory attachment).
//
// Agent audience only, by construction: this roster is what the memory
// attachment connects to, and the record's org, subject, and provenance
// all derive from the credential and the runner-threaded capture context
// (context.ts) — no org argument exists to invite rejected calls, and no
// argument can aim the record at another person. The tool is deliberately
// NOT on the full roster: a human operator manages memories through the
// console and SDK, which carry the addressing this path derives.
//
// The tool creates a PROPOSAL and nothing more (DD-005 D2/D3): the record
// lands lifecycle_state=proposed, and only the user's confirm — a
// control-plane command the model cannot reach — makes it recallable. The
// answer's `outcome` line states this so the model relays honestly.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveToken, type BackendTarget } from "../client.js";
import { proposeMemory } from "./calls.js";
import {
  resolveCaptureContext,
  type CaptureContext,
  type RequestHeaders,
} from "./context.js";
import { memoryResult } from "./errors.js";

/**
 * Register the memory capture tool; returns the tool names.
 *
 * `startupContext` is the stdio-shape capture context (env-loaded at
 * server construction); over HTTP each request's headers supersede it —
 * the resolveToken fallback shape, applied to attribution.
 */
export function registerMemoryTools(
  server: McpServer,
  target: BackendTarget,
  startupContext: CaptureContext,
): string[] {
  server.registerTool(
    "remember",
    {
      description:
        "Propose one durable fact about the person you are assisting, to be recalled in " +
        "their future sessions — a stable preference, situation, or way of working " +
        "(e.g. \"Prefers concise answers with code examples\"). Not task state, not " +
        "secrets or credentials, not one-off details. The fact is only PROPOSED: the " +
        "user reviews the exact text and decides — tell them you have suggested it, " +
        "never that you have remembered it. Keep each fact self-contained and under " +
        "500 characters; call once per fact.",
      inputSchema: {
        fact: z
          .string()
          .describe(
            "The fact to remember, stated in the third person and self-contained " +
              '(e.g. "Works primarily in Go and prefers table-driven tests"). ' +
              "1–500 characters; stored and shown to the user verbatim.",
          ),
      },
    },
    (args, extra) =>
      memoryResult("memory proposal", () =>
        proposeMemory(
          target.serverAddress,
          resolveToken(extra, target.apiKey),
          args.fact,
          resolveCaptureContext(extra as RequestHeaders, startupContext),
        ),
      ),
  );

  return ["remember"];
}
