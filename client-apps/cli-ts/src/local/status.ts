// `stigmer status` — render the local stack's health as a structured result.
//
// Source of truth is `health-state.json`, written by the daemon's health
// monitor. If it is missing but the server port answers (the daemon wrote a PID
// but not yet a snapshot, or an older daemon), we synthesize a minimal snapshot
// from a TCP probe so `status` never lies about a running server. Components are
// always rendered in a fixed, dependency-ordered sequence so the output reads
// the same on every machine.

import { homedir } from "node:os";
import { join } from "node:path";
import { load as loadConfig } from "../config/config.js";
import { configPath } from "../config/paths.js";
import { CommandResult } from "../output/command-result.js";
import { SERVER_PORT, TEMPORAL_UI_PORT, WEB_CONSOLE_PORT } from "./constants.js";
import { resolveApiKey, resolveModel, resolveProvider } from "./llm-config.js";
import { tcpConnects } from "./net/tcp.js";
import { dataDir } from "./paths.js";
import { type ComponentState, type HealthState, loadHealthState } from "./state/health-state.js";
import { DAEMON_PID_FILE } from "./constants.js";
import { readPidFile } from "./state/pidfile.js";
import { isProcessAlive } from "./state/proc.js";

const COMPONENT_ORDER = ["temporal", "stigmer-server", "runner", "web-console"] as const;
const COMPONENT_LABELS: Record<string, string> = {
  temporal: "Temporal",
  "stigmer-server": "Stigmer Server",
  runner: "Runner",
  "web-console": "Web Console",
};

/** Probe a port for liveness; the real one connects over TCP. Injectable so
 * status rendering is testable without depending on a real listener. */
export type PortProbe = (port: number) => Promise<boolean>;

const defaultProbe: PortProbe = (port) => tcpConnects(port, "127.0.0.1", 1000);

/** Build the status result for the local stack rooted at `home`. */
export async function buildStatusResult(home: string = homedir(), probe: PortProbe = defaultProbe): Promise<CommandResult> {
  const data = dataDir(home);
  const pid = readPidFile(join(data, DAEMON_PID_FILE));
  const daemonAlive = pid !== null && isProcessAlive(pid);
  const portOpen = await probe(SERVER_PORT);

  if (!daemonAlive && !portOpen) {
    return CommandResult.warning("Stigmer server is not running").hint("To start: stigmer up");
  }

  const health = loadHealthState(join(data, "health-state.json")) ?? synthesizeHealth(pid, portOpen);

  const result = CommandResult.success("Stigmer server is running");

  const daemon = result.addSection("Daemon");
  daemon.field("PID", String(health.daemon_pid));
  daemon.field("Port", String(SERVER_PORT));
  daemon.field("Data", data);
  const uptime = uptimeFrom(health.started_at);
  if (uptime !== null) daemon.field("Uptime", uptime);

  for (const name of COMPONENT_ORDER) {
    const component = health.components[name];
    if (component === undefined) {
      if (name === "web-console") continue; // optional; omit when absent
      result.addSection(COMPONENT_LABELS[name]).field("Status", "Not Running ○");
      continue;
    }
    addComponentSection(result, name, COMPONENT_LABELS[name], component);
  }

  addLlmSection(result, home);
  addWebUiSection(result, health);

  return result;
}

function synthesizeHealth(pid: number | null, portOpen: boolean): HealthState {
  // No snapshot on disk: report only what a TCP probe can prove. If the port
  // answers the server is running; otherwise leave components empty so the
  // renderer shows them as "Not Running" rather than inventing a state.
  const components: HealthState["components"] = portOpen
    ? { "stigmer-server": { pid: 0, state: "running", restart_count: 0, started_at: "" } }
    : {};
  return { daemon_pid: pid ?? 0, started_at: "", components };
}

function addComponentSection(result: CommandResult, name: string, label: string, component: ComponentState): void {
  const section = result.addSection(label);
  const state = component.state || "unknown";

  let status = `${displayState(state)} ${symbolFor(state)}`;
  // The runner reports observed readiness (it polls its Temporal queue) on top
  // of mere liveness — the truthful-visibility improvement over the Go CLI.
  if (name === "runner" && state === "running") {
    status += component.ready === true ? " (polling)" : " (starting)";
  }
  section.field("Status", status);

  if (component.pid > 0) section.field("PID", String(component.pid));
  const uptime = uptimeFrom(component.started_at);
  if (uptime !== null) section.field("Uptime", uptime);
  section.field("Restarts", String(component.restart_count));

  if (component.last_error && (state === "failed" || state === "stopped")) {
    section.field("Last Error", component.last_error);
  }
  if (state === "failed" || state === "stopped") {
    result.hint(`View ${name} logs: stigmer logs --component ${name}`);
  }
}

function addLlmSection(result: CommandResult, home: string): void {
  const config = loadConfig(configPath(home));
  const provider = resolveProvider(config);
  const section = result.addSection("LLM Configuration");

  if (provider === "") {
    section.field("Provider", "Not configured");
    section.field("Status", "Agents will not execute");
    result.hint("Configure a provider: stigmer setup");
    return;
  }

  const model = resolveModel(config);
  switch (provider) {
    case "ollama":
      section.field("Provider", "Local (Ollama)");
      section.field("Model", model);
      break;
    case "anthropic":
    case "openai":
      section.field("Provider", provider === "anthropic" ? "Anthropic (Cloud)" : "OpenAI (Cloud)");
      section.field("Model", model);
      section.field("API Key", resolveApiKey(config) !== "" ? "Configured ✓" : "Not configured ✗");
      break;
    default:
      section.field("Provider", `Unknown (${provider})`);
  }
}

function addWebUiSection(result: CommandResult, health: HealthState): void {
  const temporalRunning = health.components.temporal?.state === "running";
  const webRunning = health.components["web-console"]?.state === "running";
  if (!temporalRunning && !webRunning) return;

  const section = result.addSection("Web UI");
  if (webRunning) section.field("Console", `http://localhost:${WEB_CONSOLE_PORT}`);
  if (temporalRunning) section.field("Temporal", `http://localhost:${TEMPORAL_UI_PORT}`);
}

const STATE_SYMBOLS: Record<string, string> = {
  running: "✓",
  unhealthy: "◐",
  starting: "◌",
  stopped: "○",
  failed: "✗",
  unknown: "○",
};

function symbolFor(state: string): string {
  return STATE_SYMBOLS[state] ?? "○";
}

function displayState(state: string): string {
  return state.charAt(0).toUpperCase() + state.slice(1);
}

function uptimeFrom(startedAt: string): string | null {
  if (startedAt === "") return null;
  const started = Date.parse(startedAt);
  if (Number.isNaN(started)) return null;
  return formatDuration(Date.now() - started);
}

/** Human-readable, coarse duration ("2h 5m", "3m 12s", "8s"). */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
