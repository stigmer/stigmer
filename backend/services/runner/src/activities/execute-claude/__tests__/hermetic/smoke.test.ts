import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../../../client/stigmer-client.js", async () =>
  (await import("../../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import { bindHermeticClient, createHermeticEnvironment, statusGolden } from "../../../../__test-utils__/hermetic-activity.js";
import { stubRegistryFetch } from "../../../../__test-utils__/model-registry-fixture.js";
import { anthropicText, anthropicToolUses, startClaudeWire, type ClaudeWire } from "../../__test-utils__/claude-wire.js";
import { claudeExecutionRecord, hermeticClaudeConfig, resetClaudeScenarioState, runClaudeInvocation, sessionWorkspaceDir } from "../../__test-utils__/hermetic-claude.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const env = createHermeticEnvironment();
const config = hermeticClaudeConfig(env);
let wire: ClaudeWire;
let registry: ReturnType<typeof stubRegistryFetch>;

describe("smoke", () => {
  beforeAll(async () => {
    registry = stubRegistryFetch();
    wire = await startClaudeWire(config, (c) => {
      if (!c.issued.has("toolu_read_1")) return anthropicToolUses([{ toolCallId: "toolu_read_1", toolName: "Read", toolInput: { file_path: join(sessionWorkspaceDir(env), "a.txt") } }]);
      if (!c.issued.has("toolu_bash_1")) return anthropicToolUses([{ toolCallId: "toolu_bash_1", toolName: "Bash", toolInput: { command: "echo hi", description: "say hi" } }]);
      return anthropicText("done");
    });
  });
  afterAll(async () => {
    await wire.close();
    registry.restore();
    env.dispose();
  });

  it("runs a turn", async () => {
    resetClaudeScenarioState(env);
    mkdirSync(sessionWorkspaceDir(env), { recursive: true });
    writeFileSync(join(sessionWorkspaceDir(env), "a.txt"), "hello file");
    const record = claudeExecutionRecord({ message: "read a.txt" });
    bindHermeticClient(record.client());
    const run = await runClaudeInvocation(config, wire.proxy, record);
    console.log("OUTCOME", JSON.stringify(run.outcome).slice(0, 2000));
    console.log("PHASES", record.persistedPhases);
    console.log("STATUS", record.lastFullStatus ? statusGolden(record.lastFullStatus).slice(0, 4000) : "none");
    console.log("ROWS", JSON.stringify(record.toolCalls().map((t) => ({ id: t.id, name: t.name, status: t.status, result: t.result, error: t.error }))));
    console.log("REQS", JSON.stringify(wire.requests().map((r) => ({ path: r.path, disp: r.disposition, h: { key: r.headers["x-api-key"], auth: r.headers.authorization, exec: r.headers["x-stigmer-execution-id"] } }))));
    expect(run.outcome.kind).toBe("returned");
  }, 120_000);
});
