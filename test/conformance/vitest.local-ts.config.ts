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
//   - workflowexecution — sub-project #20 (sp.workflowexecution-domain;
//     the Class A engineless surface: the create gate, the CW-7
//     zero-record reads, the subscribe/subscribeEvents error arms, and
//     the submitFileDecision negatives. The Class B suites in
//     suites-execution/ roster with #21's orchestrator).
//   - mcpserver + agent-mcpserver-references — sub-project #9
//     (sp.mcpserver-crud; the declarative CRUD slice with the #402
//     enabledtools validation and the #558 org-OAuth UNIMPLEMENTED pins;
//     the agent-references suite was split out by sp.agent-family DD-001
//     and held for this entry, whose McpServer service its accept-path
//     fixture needs. The connect/OAuth slice arrives with #19).
//   - skill — sub-project #8 (sp.skill; push-only content-addressed
//     artifacts, the version-resolution ladder, and the #675 HTTP transfer
//     lane — skillArtifactTransferLane is honest on this target from this
//     entry on).
//   - agentshare + agentchannel + channelapp — sub-project #12
//     (sp.sharing-and-channels; the sharing/channel family: the anonymous
//     getSharedProfile lane + cross-org contract, the four channel
//     registration blocks with the three cloud-only refusal postures, and
//     the per-field secret rotation. The agentshare suite's cross-org
//     blocker test creates a McpServer, so this entry rostered after
//     entry #9 merged — the ratified merge-order ruling).
//   - oauthapp + platform + github + artifact — sub-project #13
//     (sp.small-domains; the four small remaining Class A domains, incl.
//     the client-secret contract, the runner-bootstrap shapes, the broker
//     Layer-1 arms, and the artifact file-server disposition lane). The
//     oauthapp suite's delete-block test drives McpServer create/delete,
//     so it rosters here only after #9 (McpServer CRUD) merged.
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
      "src/suites/workflowexecution.conformance.test.ts",
      "src/suites/mcpserver.conformance.test.ts",
      "src/suites/agent-mcpserver-references.conformance.test.ts",
      "src/suites/skill.conformance.test.ts",
      "src/suites/agentshare.conformance.test.ts",
      "src/suites/agentchannel.conformance.test.ts",
      "src/suites/channelapp.conformance.test.ts",
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
