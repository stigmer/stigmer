// Vitest configuration for the local-ts roster — the TS server's parity
// gate (stigmer-cloud program 20260822.01, D4).
//
// The include list IS the roster: it grows per domain sub-project until it
// equals vitest.config.ts's full glob — that roster equality is the
// cutover gate. Every listed suite runs UNCHANGED against the TS server;
// capability flags are byte-identical to local-go, so both servers face
// the same assertions.
//
// Roster history:
//   - organization + registry-proxy — sub-project #4 (storage + pipeline;
//     registry-proxy exercises the #3 transport lanes, DD-003).
//   - environment — sub-project #5 (encryption + runnerauth + the
//     Environment domain; the first secret-bearing suite).
//   - agent + agentinstance + session + memory — sub-project #6
//     (sp.agent-family; the agent aggregate and its satellite domains).
//     agent-mcpserver-references.conformance.test.ts (split out of the
//     agent suite by sub-project DD-001) will roster here when entry #9
//     (McpServer CRUD) lands; until then it runs only on the Go rosters.
//   - workflow + workflowinstance — sub-project #7 (sp.workflow-family;
//     authoring/validation/versioning incl. the #341 head-repoint and the
//     CW-9 updateVisibility block).
//   - executioncontext — sub-project #15 (sp.executioncontext; the
//     create-only secret-delivery domain. The suite is user-shaped by
//     design — the runner-token decrypt lane is proven by the domain's
//     own __tests__/executioncontext.test.ts).
//   - agentexecution — sub-project #17 (sp.agentexecution-domain; the
//     deepest domain: 23 RPCs incl. the subscribe stream, the HITL
//     surfaces, and the engine-gate/lifecycle negatives that pin the
//     no-Temporal posture until #18).
//   - oauthapp + platform + github + artifact — sub-project #13
//     (sp.small-domains; the four small remaining Class A domains, incl.
//     the client-secret contract, the runner-bootstrap shapes, the broker
//     Layer-1 arms, and the artifact file-server disposition lane). The
//     oauthapp suite's delete-block test drives McpServer create/delete —
//     it goes green here the moment #9 (McpServer CRUD) merges, the
//     recorded merge-order dependency of this entry.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "src/suites/organization.conformance.test.ts",
      "src/suites/registry-proxy.conformance.test.ts",
      "src/suites/environment.conformance.test.ts",
      "src/suites/agent.conformance.test.ts",
      "src/suites/agentinstance.conformance.test.ts",
      "src/suites/session.conformance.test.ts",
      "src/suites/memory.conformance.test.ts",
      "src/suites/workflow.conformance.test.ts",
      "src/suites/workflowinstance.conformance.test.ts",
      "src/suites/executioncontext.conformance.test.ts",
      "src/suites/agentexecution.conformance.test.ts",
      "src/suites/oauthapp.conformance.test.ts",
      "src/suites/platform.conformance.test.ts",
      "src/suites/github.conformance.test.ts",
      "src/suites/artifact.conformance.test.ts",
    ],
    globalSetup: ["./src/harness/global-setup-ts.ts"],
    env: {
      CONFORMANCE_TARGET: process.env.CONFORMANCE_TARGET ?? "local-ts",
    },
    // Per-test RPCs are fast; the budget covers retries under load.
    testTimeout: 30_000,
    // Covers server process boot + gRPC readiness gate in beforeAll.
    hookTimeout: 60_000,
  },
});
