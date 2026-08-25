// Vitest configuration for the local-ts-execution roster (Class B on the
// TS server) — vitest.execution.config.ts's twin with an EXPLICIT include
// list instead of the glob.
//
// The include list IS the roster (the same mechanism as
// vitest.local-ts.config.ts): it starts at the agent-execution suites (D4
// #18) and grows per execution sub-project — workflowexecution suites with
// #20/#21, schedule firing with #22, the child-approval flip with #23 —
// until it equals the execution glob. Roster equality is the Class B half
// of the cutover gate. Green with NO skips and NO filters (D4's ratified
// gating): a suite enters this list only when the TS engine serves it.
//
// Roster history:
//   #18 (2026-08-24): the agent-execution slice — agentexecution CRUD+
//   lifecycle+subscribe, recover, memory-retrieval, the agent harness
//   smoke, session-immutability, the envmerge agent half (the workflow
//   half needs the #20/#21 engine; the file was split for exactly this
//   roster — sub-project 20260824.03 brief #3), and open-computer-use
//   (the STIGMER_DESKTOP_TESTS opt-in gate — CI-inert exactly as on the
//   Go target). DEFERRED to #9 mcpserver-crud (sub-project 20260824.03
//   DD-002, owner-ratified): agentexecution-approval (the HITL matrix),
//   mcp.harness.smoke, and mcp-caller-identity register McpServer
//   resources as their tool surface — a domain this server serves only
//   once #9 ports it.
//
//   #21 (2026-08-25): the DD-002 deferral's carrier corrected — #9 merged
//   BEFORE this roster file existed, so its PR could not roster the three
//   MCP-dependent suites; they enter in #21's pre-flight, proven green
//   against the TS engine (the "HITL matrix green" acceptance transfers
//   to #21's PR).
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "src/suites-execution/agentexecution.conformance.test.ts",
      "src/suites-execution/agentexecution-approval.conformance.test.ts",
      "src/suites-execution/agentexecution-recover.conformance.test.ts",
      "src/suites-execution/agentexecution-memory-retrieval.conformance.test.ts",
      "src/suites-execution/agent.harness.smoke.test.ts",
      "src/suites-execution/mcp.harness.smoke.test.ts",
      "src/suites-execution/mcp-caller-identity.conformance.test.ts",
      "src/suites-execution/open-computer-use.conformance.test.ts",
      "src/suites-execution/session-immutability.conformance.test.ts",
      "src/suites-execution/envmerge-agent.conformance.test.ts",
    ],
    globalSetup: ["./src/harness/global-setup-ts-execution.ts"],
    env: {
      CONFORMANCE_TARGET: process.env.CONFORMANCE_TARGET ?? "local-ts-execution",
    },
    // A real execution spans Temporal dispatch + runner pickup + status stream.
    testTimeout: 120_000,
    // Covers Temporal boot + server boot + runner boot in beforeAll.
    hookTimeout: 180_000,
    // Each execution suite file boots its own Temporal + server + runner stack;
    // serial keeps N suites from running N concurrent engines (the execution
    // config's rationale, unchanged).
    fileParallelism: false,
  },
});
