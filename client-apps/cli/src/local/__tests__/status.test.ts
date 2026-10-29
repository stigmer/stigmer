import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { configPath } from "../../config/paths.js";
import { DAEMON_PID_FILE } from "../constants.js";
import { dataDir } from "../paths.js";
import type { HealthState } from "../state/health-state.js";
import { buildStatusResult, formatDuration } from "../status.js";

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
    writeFileSync(configPath(home), "backend:\n  local:\n    llm:\n      provider: anthropic\n      api_key: sk-x\n");

    const result = await buildStatusResult(home, open, {});
    expect(result.status).toBe("success");

    const titles = result.sections.map((s) => s.title);
    expect(titles.indexOf("Temporal")).toBeLessThan(titles.indexOf("Stigmer Server"));
    expect(titles.indexOf("Stigmer Server")).toBeLessThan(titles.indexOf("Runner"));

    expect(field(result, "Runner", "Status")).toBe("Running ✓ (polling)");
    expect(field(result, "Runner", "Restarts")).toBe("1");
    // The key `stigmer setup` saved reaches the runner, so Anthropic is reached by key.
    expect(field(result, "LLM Configuration", "Providers")).toBe("anthropic (key)");
    // No model configured: the platform model registry owns the execution
    // default, and status says so instead of asserting a version.
    expect(field(result, "LLM Configuration", "Model")).toBe("Auto (platform default)");
    expect(field(result, "Web UI", "Temporal")).toBe("http://localhost:8233");
  });

  it("ignores a stale model key from a pre-oss#314 config — the pin never reached execution, so status must not display it", async () => {
    writeHealth({ daemon_pid: process.pid, started_at: new Date().toISOString(), components: {} });
    writeFileSync(configPath(home), "backend:\n  local:\n    llm:\n      provider: anthropic\n      model: claude-x\n      api_key: sk-x\n");

    const result = await buildStatusResult(home, open, {});
    expect(field(result, "LLM Configuration", "Model")).toBe("Auto (platform default)");
  });

  it("tells a stack that reaches no provider that agents will not execute, and names stigmer setup", async () => {
    writeHealth({ daemon_pid: process.pid, started_at: new Date().toISOString(), components: {} });
    // A saved provider the launcher does not deliver a key for reaches nothing.
    writeFileSync(configPath(home), "backend:\n  local:\n    llm:\n      provider: ollama\n");

    const result = await buildStatusResult(home, open, { OPENAI_API_KEY: " " });
    expect(field(result, "LLM Configuration", "Providers")).toBe("Not configured");
    expect(field(result, "LLM Configuration", "Status")).toBe("Agents will not execute");
    expect(result.hints).toContain("Configure a provider: stigmer setup");
  });

  it("judges by the runner's reach: an OpenAI key, a cloud backend or a gateway lets agents run", async () => {
    writeHealth({ daemon_pid: process.pid, started_at: new Date().toISOString(), components: {} });

    const openai = await buildStatusResult(home, open, { OPENAI_API_KEY: "sk-oa" });
    expect(field(openai, "LLM Configuration", "Providers")).toBe("openai (key)");
    expect(field(openai, "LLM Configuration", "Status")).toBeUndefined();

    const vertex = await buildStatusResult(home, open, { STIGMER_ANTHROPIC_BACKEND: "vertex", CLOUD_ML_REGION: "global" });
    expect(field(vertex, "LLM Configuration", "Providers")).toBe("anthropic (vertex)");

    const gateway = await buildStatusResult(home, open, { ANTHROPIC_BASE_URL: "https://llm-gateway.internal" });
    expect(field(gateway, "LLM Configuration", "Providers")).toBe("anthropic (gateway)");
    expect(gateway.hints).not.toContain("Configure a provider: stigmer setup");
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

  it("shows a failed component's last error and where its logs are", async () => {
    writeHealth({
      daemon_pid: process.pid,
      started_at: new Date().toISOString(),
      components: {
        "stigmer-server": {
          pid: 11,
          state: "failed",
          restart_count: 0,
          started_at: new Date().toISOString(),
          last_error: "the server exited with code 1 before it was ready",
          last_output: ["boot failed: bad setting"],
        },
      },
    });
    const result = await buildStatusResult(home, closed);
    expect(field(result, "Stigmer Server", "Last Error")).toBe("the server exited with code 1 before it was ready");
    expect(result.hints).toContain("View stigmer-server logs: stigmer logs --component stigmer-server");
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
