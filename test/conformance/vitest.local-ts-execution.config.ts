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
//   to #21's PR). The workflowexecution slice: the four workflowexecution
//   suites + the envmerge workflow half (split at #18 for exactly this
//   moment). Still out: workflowexecution-child-approval (the #23 flag
//   flip) and schedule-firing (#22). (#19, running in parallel, absorbed
//   the same three suites independently — the concurrent sessions closed
//   the same gap; #21 landed first, so its rostering stands.)
//
//   #19 (2026-08-25, sp.mcpserver-connect-oauth): mcpserver-connect —
//   the CW-1 Class B slice: connect/startConnect discovery through the
//   runner's stigmer/mcp-server/connect workflow (deterministic-ID
//   attach, dead-runner warning), handshake completion against the mock
//   authorization server, and the refresh-on-connect pre-flight.
//
//   #23 (2026-08-25, sp.child-approval-derivation): workflowexecution-
//   child-approval — the June-written suite runs whole (negatives + the
//   DD-012 forwarding round-trip) now that the TS HITL loop emits
//   child_approval_required. Pre-flight debt cleared alongside it:
//   harness.smoke (the target-agnostic set_vars engine smoke) was in the
//   execution glob but never rostered by #20/#21 — proven green here.
//   With both entries the roster EQUALS the execution glob: the Class B
//   half of the cutover gate (D4 #24) is satisfied.
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
      "src/suites-execution/envmerge-workflow.conformance.test.ts",
      "src/suites-execution/workflowexecution.conformance.test.ts",
      "src/suites-execution/workflowexecution-approval.conformance.test.ts",
      "src/suites-execution/workflowexecution-signal.conformance.test.ts",
      "src/suites-execution/workflowexecution-recover.conformance.test.ts",
      "src/suites-execution/mcpserver-connect.conformance.test.ts",
      // schedule firing — sub-project #22 (sp.schedule): the synchronous
      // trigger outcome, the manual-fires-never-feed-the-streak pin, and
      // the listRuns history surface, active now that scheduleFiring
      // flipped true on this target.
      "src/suites-execution/schedule-firing.conformance.test.ts",
      // child-approval forwarding — sub-project #23 (the LAST roster entries
      // before the #24 cutover gate): the June-written DD-012 suite, whole —
      // the edition-agnostic submitApproval negatives AND the forwarding
      // round-trip, active now that workflowChildApprovalForwarding flipped
      // true on this target (the TS HITL loop emits child_approval_required).
      "src/suites-execution/workflowexecution-child-approval.conformance.test.ts",
      // The target-agnostic set_vars engine smoke — glob-resident since June,
      // missed by #20/#21's rostering; carried in by #23 for glob equality.
      "src/suites-execution/harness.smoke.test.ts",
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
