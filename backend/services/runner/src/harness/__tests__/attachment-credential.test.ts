/**
 * The credential the platform's own MCP attachments carry
 * (`harness/turn-context.ts` `resolveMcpServersAndPolicies`, #2062): the
 * attachments run on the agent's side of the turn, so they carry a
 * credential scoped to this run and never the runner's own key.
 *
 * Pinned, through the phase itself with the client at its seam:
 *  - a credential scoped to the run: the attachments carry it;
 *  - a runner holding a key whose exchange fails (or answers nothing): the
 *    turn runs without the platform's attachments, says so in the
 *    transcript, and the runner's key is in no attachment;
 *  - a runner holding no credential (a trusted-local server): the
 *    attachments run without one, as before;
 *  - a runner whose ambient credential is already scoped below it (a cloud
 *    sandbox's session token): the attachments carry it, until the cloud
 *    mints run credentials (#2080).
 */

import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { RunSchema, RunStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RecalledMemoriesSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/spec_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { SessionSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/spec_pb";

import { testConfig } from "../../__test-utils__/config-fixture.js";
import type { StigmerClient } from "../../client/stigmer-client.js";
import type { ResolvedBlueprint } from "../../shared/blueprint-resolver.js";
import { TimingRecorder } from "../../shared/cold-start-timing.js";
import { NO_RUN_VALUES } from "../../shared/run-values.js";
import { TranscriptBuilder } from "../transcript/builder.js";
import { PLATFORM_TOOLS_OFF_NOTICE, resolveMcpServersAndPolicies, type ResolutionDeps } from "../turn-context.js";

const RUNNER_KEY = "stigmer_runner_own_key";

async function resolveWith(exchange: () => Promise<string | undefined>, runnerKey: string | null) {
  const status = create(RunStatusSchema);
  const client = {
    acquireScopedRunnerToken: exchange,
    listMessagingChannels: async () => [],
  } as unknown as StigmerClient;
  const deps: ResolutionDeps = {
    input: { executionId: "aex-attach", threadId: "", turnSeq: 0 },
    client,
    config: testConfig({ stigmerTokenRef: { current: runnerKey }, mcpBridgeEndpoint: "http://bridge.local" }),
    status,
    transcript: new TranscriptBuilder("aex-attach", status),
    artifactStorage: undefined,
    timing: new TimingRecorder(),
    signal: new AbortController().signal,
    heartbeat: () => {},
    enterPhase: () => {},
    reportProgress: async () => {},
  };
  const session = create(SessionSchema, { metadata: { org: "org-1" } });
  const blueprint = {
    agent: undefined,
    session,
    sessionSpec: create(SessionSpecSchema),
    instructions: "",
    subAgents: [],
    plugins: [],
    mergedSkillRefs: [],
    cloudRepos: [],
  } as ResolvedBlueprint;
  const mcp = await resolveMcpServersAndPolicies(deps, {
    execution: create(RunSchema, { status: create(RunStatusSchema, { recalledMemories: create(RecalledMemoriesSchema, { enabled: true }) }) }),
    session,
    sessionId: "ses-attach",
    blueprint,
    values: NO_RUN_VALUES,
    readsToolMarks: true,
  });
  return { mcp, status };
}

describe("the platform's attachments' credential", () => {
  it("carries the run's own credential when there is one", async () => {
    const { mcp, status } = await resolveWith(async () => "run-scoped-token", RUNNER_KEY);
    expect(mcp.platformServerSlugs.size).toBeGreaterThan(0);
    expect(JSON.stringify(mcp.servers)).toContain("run-scoped-token");
    expect(JSON.stringify(mcp.servers)).not.toContain(RUNNER_KEY);
    expect(status.messages).toEqual([]);
  });

  it("runs the turn without them, and says so, when the runner's key cannot be exchanged", async () => {
    for (const exchange of [async () => Promise.reject(new Error("exchange refused")), async () => undefined]) {
      const { mcp, status } = await resolveWith(exchange, RUNNER_KEY);
      expect(mcp.platformServerSlugs.size).toBe(0);
      expect(JSON.stringify(mcp.servers)).not.toContain(RUNNER_KEY);
      expect(status.messages.map((m) => m.content)).toEqual([PLATFORM_TOOLS_OFF_NOTICE]);
    }
  });

  it("carries a cloud sandbox's session token, already scoped below the runner", async () => {
    const sandboxToken = `${Buffer.from('{"alg":"RS256"}').toString("base64url")}.${Buffer.from('{"token_type":"sandbox"}').toString("base64url")}.sig`;
    const { mcp, status } = await resolveWith(async () => undefined, sandboxToken);
    expect(mcp.platformServerSlugs.size).toBeGreaterThan(0);
    expect(JSON.stringify(mcp.servers)).toContain(sandboxToken);
    expect(status.messages).toEqual([]);
  });

  it("runs them without a credential on a runner that holds none", async () => {
    const { mcp, status } = await resolveWith(async () => undefined, null);
    expect(mcp.platformServerSlugs.size).toBeGreaterThan(0);
    expect(status.messages).toEqual([]);
  });
});
