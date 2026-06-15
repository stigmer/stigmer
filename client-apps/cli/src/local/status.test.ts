import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { configPath } from "../config/paths.js";
import { DAEMON_PID_FILE } from "./constants.js";
import { dataDir } from "./paths.js";
import type { HealthState } from "./state/health-state.js";
import { buildStatusResult, formatDuration } from "./status.js";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "stigmer-status-"));
});

const open = async () => true;
const closed = async () => false;

function field(result: Awaited<ReturnType<typeof buildStatusResult>>, section: string, key: string): string | undefined {
  return result.sections.find((s) => s.title === section)?.fields.find((f) => f.key === key)?.value;
}

function writeHealth(state: HealthState): void {
  mkdirSync(dataDir(home), { recursive: true });
  writeFileSync(join(dataDir(home), DAEMON_PID_FILE), String(process.pid));
  writeFileSync(join(dataDir(home), "health-state.json"), JSON.stringify(state));
}

describe("buildStatusResult", () => {
  it("reports not-running when no daemon and the port is closed", async () => {
    const result = await buildStatusResult(home, closed);
    expect(result.status).toBe("warning");
    expect(result.message).toMatch(/not running/);
  });

  it("renders components in order, with runner readiness", async () => {
    writeHealth({
      daemon_pid: process.pid,
      started_at: new Date().toISOString(),
      components: {
        temporal: { pid: 10, state: "running", restart_count: 0, started_at: new Date().toISOString() },
        "stigmer-server": { pid: 11, state: "running", restart_count: 0, started_at: new Date().toISOString() },
        runner: { pid: 12, state: "running", restart_count: 1, started_at: new Date().toISOString(), ready: true },
      },
    });
    writeFileSync(configPath(home), "backend:\n  type: local\n  local:\n    llm:\n      provider: anthropic\n      api_key: sk-x\n");

    const result = await buildStatusResult(home, open);
    expect(result.status).toBe("success");

    const titles = result.sections.map((s) => s.title);
    expect(titles.indexOf("Temporal")).toBeLessThan(titles.indexOf("Stigmer Server"));
    expect(titles.indexOf("Stigmer Server")).toBeLessThan(titles.indexOf("Runner"));

    expect(field(result, "Runner", "Status")).toBe("Running ✓ (polling)");
    expect(field(result, "Runner", "Restarts")).toBe("1");
    expect(field(result, "LLM Configuration", "Provider")).toBe("Anthropic (Cloud)");
    expect(field(result, "LLM Configuration", "API Key")).toBe("Configured ✓");
    expect(field(result, "Web UI", "Temporal")).toBe("http://localhost:8233");
  });

  it("shows runner as starting before the readiness marker", async () => {
    writeHealth({
      daemon_pid: process.pid,
      started_at: new Date().toISOString(),
      components: {
        runner: { pid: 12, state: "running", restart_count: 0, started_at: new Date().toISOString(), ready: false },
      },
    });
    const result = await buildStatusResult(home, open);
    expect(field(result, "Runner", "Status")).toBe("Running ✓ (starting)");
  });

  it("synthesizes a running server when only the port answers", async () => {
    const result = await buildStatusResult(home, open);
    expect(result.status).toBe("success");
    expect(field(result, "Stigmer Server", "Status")).toBe("Running ✓");
  });
});

describe("formatDuration", () => {
  it("renders coarse human durations", () => {
    expect(formatDuration(5_000)).toBe("5s");
    expect(formatDuration(125_000)).toBe("2m 5s");
    expect(formatDuration(3_700_000)).toBe("1h 1m");
    expect(formatDuration(90_000_000)).toBe("1d 1h");
  });
});
