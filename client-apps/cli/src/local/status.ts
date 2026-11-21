// `stigmer status` — say which server the CLI uses, then render the local
// stack's health as a structured result.
//
// It names the backend the CLI uses and its address first, read from the
// same resolver the backend client dials by (config/resolve.ts). When that is
// not the local stack (a self-hosted server, Stigmer Cloud, or an address in
// STIGMER_SERVER_ADDRESS), a missing local stack is nothing wrong: it says so
// and returns success, with no hint to start one, since a person signed in to
// their own server who follows `stigmer up` starts a second server
// (stigmer#3369). It never asks the remote server anything; reaching it is
// `stigmer auth whoami`'s. A backend config that cannot be read is shown on
// the Backend line with its own error, and the local stack is still reported:
// a diagnostic command never fails on what it diagnoses.
//
// Source of truth is `health-state.json`, written by the daemon's health
// monitor. If it is missing but the server port answers (the daemon wrote a PID
// but not yet a snapshot, or an older daemon), we synthesize a minimal snapshot
// from a TCP probe so `status` never lies about a running server. Components are
// always rendered in a fixed, dependency-ordered sequence so the output reads
// the same on every machine.

import { formatElapsed } from "@stigmer/client";
import { homedir } from "node:os";
import { join } from "node:path";
import { activeBackend, load as loadConfig } from "../config/config.js";
import { configPath } from "../config/paths.js";
import { resolveServerAddress } from "../config/resolve.js";
import { CommandResult } from "../output/command-result.js";
import { SERVER_PORT, TEMPORAL_UI_PORT } from "./constants.js";
import { resolveApiKey } from "./llm-config.js";
import { describeReach, providerReach } from "./provider-reach.js";
import { tcpConnects } from "./net/tcp.js";
import { dataDir } from "./paths.js";
import { type ComponentState, type HealthState, componentLogsHint, loadHealthState } from "./state/health-state.js";
import { DAEMON_PID_FILE } from "./constants.js";
import { recordedLiveProcess } from "./state/pidfile.js";

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

/** Build the status result for the local stack rooted at `home`; `env` is the shell `stigmer up` would launch from. */
export async function buildStatusResult(
  home: string = homedir(),
  probe: PortProbe = defaultProbe,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CommandResult> {
  const data = dataDir(home);
  // A recorded PID counts only while it is the daemon recorded, never a
  // program that inherited the number (stigmer#2750).
  const pid = recordedLiveProcess(join(data, DAEMON_PID_FILE));
  const daemonAlive = pid !== null;
  const portOpen = await probe(SERVER_PORT);
  const backend = backendInUse(home, env);
  const elsewhere = backend.kind === "remote";

  if (!daemonAlive && !portOpen) {
    if (elsewhere) {
      const result = CommandResult.success(usesMessage(backend));
      addBackendSection(result, backend);
      result.addSection("Local Stack").field("Status", "Not running ○");
      return result;
    }
    const result = CommandResult.warning("Stigmer server is not running");
    addBackendSection(result, backend);
    return result.hint("To start: stigmer up");
  }

  const health = loadHealthState(join(data, "health-state.json")) ?? synthesizeHealth(pid, portOpen);

  const result = CommandResult.success(elsewhere ? usesMessage(backend) : "Stigmer server is running");
  addBackendSection(result, backend);

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

  addLlmSection(result, home, env);
  addWebUiSection(result, health);

  return result;
}

/** The server the CLI uses: the local stack, another server, or a config that names none it can read. */
type BackendInUse =
  | { readonly kind: "local"; readonly name: string; readonly address: string }
  | { readonly kind: "remote"; readonly name: string; readonly address: string; readonly fromEnvironment: boolean }
  | { readonly kind: "broken"; readonly error: string };

// The local stack's own address, as the resolver names it or as an
// override may spell it; an override naming it is still the local stack.
const LOCAL_ADDRESSES = new Set([`localhost:${SERVER_PORT}`, `127.0.0.1:${SERVER_PORT}`]);

function backendInUse(home: string, env: NodeJS.ProcessEnv): BackendInUse {
  try {
    const config = loadConfig(configPath(home));
    const { name } = activeBackend(config);
    const { address, source } = resolveServerAddress(config, env);
    if (source === "local" || LOCAL_ADDRESSES.has(address)) return { kind: "local", name, address };
    return { kind: "remote", name, address, fromEnvironment: source === "environment" };
  } catch (err) {
    return { kind: "broken", error: err instanceof Error ? err.message : String(err) };
  }
}

function usesMessage(backend: Extract<BackendInUse, { kind: "remote" }>): string {
  return backend.fromEnvironment
    ? `The CLI uses ${backend.address} (STIGMER_SERVER_ADDRESS), not a local stack`
    : `The CLI uses backend "${backend.name}" at ${backend.address}, not a local stack`;
}

// The same words `stigmer config backend status` uses for the same facts.
function addBackendSection(result: CommandResult, backend: BackendInUse): void {
  const section = result.addSection("");
  if (backend.kind === "broken") {
    section.field("Backend", `unreadable: ${backend.error}`);
    result.hint("See the configured backends: stigmer config backend list");
    return;
  }
  section.field("Backend", backend.name);
  section.field("Endpoint", backend.address);
  if (backend.kind === "remote" && backend.fromEnvironment) section.field("Set by", "STIGMER_SERVER_ADDRESS");
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
  // of mere liveness — a live process that hasn't connected yet is "starting".
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
    result.hint(componentLogsHint(name));
  }
}

// Judged by the runner's own reach rule (provider-reach.ts) over the
// environment the launcher gives the runner: this shell's, with the key
// `stigmer setup` saved written over it (launch.ts, resolveLlmKeyInputs). So a
// laptop on an OpenAI key, Vertex, Bedrock, Foundry or a gateway is reported
// as reaching it, and only one that reaches nothing is told agents will not
// execute.
function addLlmSection(result: CommandResult, home: string, env: NodeJS.ProcessEnv): void {
  const config = loadConfig(configPath(home));
  const savedKey = resolveApiKey(config, env);
  const reach = providerReach(savedKey === "" ? env : { ...env, ANTHROPIC_API_KEY: savedKey });
  const section = result.addSection("LLM Configuration");

  if (reach.length === 0) {
    section.field("Providers", "Not configured");
    section.field("Status", "Agents will not execute");
    result.hint("Configure a provider: stigmer setup");
    return;
  }

  // The model line is a constant: the platform model registry picks the
  // execution default and the CLI has no model concept to report (oss#314
  // removed the dead config pin). Per-run overrides ride `stigmer run --model`.
  section.field("Providers", describeReach(reach));
  section.field("Model", "Auto (platform default)");
}

function addWebUiSection(result: CommandResult, health: HealthState): void {
  const temporalRunning = health.components.temporal?.state === "running";
  const webRunning = health.components["web-console"]?.state === "running";
  if (!temporalRunning && !webRunning) return;

  const section = result.addSection("Web UI");
  // The console shares the server's unified port — same origin as
  // the API, served by the server itself.
  if (webRunning) section.field("Console", `http://localhost:${SERVER_PORT}`);
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
  return formatElapsed(Date.now() - started);
}
