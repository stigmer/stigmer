/**
 * The runner's side of the agent host's lifetime: start it, prove it is the
 * host this build speaks to, boot the harnesses the runner asked for, route
 * its calls to the turns they belong to, and start it again when it dies.
 *
 * One host per runner process, for the adapters' worker lifetime
 * (`harness/types.ts`); the manager mode's session workers share it, as
 * they share one adapter object in-process. The remote adapters
 * (`remote-adapter.ts`) are this module's only callers.
 *
 * Starting is a {@link HostStarter}: production spawns the runner's own
 * entry in its agent-host mode with the channel on fd 3
 * ({@link processHostStarter}); the tests serve a host in this process over
 * a loopback channel. Each start mints a fresh host token and authorizes it
 * at the local proxy (`agent-proxy/`), so a token from a host that died is
 * worth nothing.
 *
 * Restart: a host that exits while the runner still needs it is started
 * again after a delay that starts at one second and doubles to thirty, the
 * backoff the attach waiter supervises the runner with
 * (`attach/waiter.ts`); a host that served longer than the longest delay
 * restarts promptly. A restarted host is booted with every harness the
 * runner booted, in the same order, before it serves a turn. A turn that
 * was running on the host that died settles at once (its pending call
 * rejects, `remote-adapter.ts`), and the next turn waits for the restart.
 *
 * Stopping: once every booted harness has been shut down, the channel is
 * closed and no restart follows. The host exits on its channel's end, as
 * the manager exits on its stdin's (`main.ts`), so a runner that is killed
 * outright leaves no host behind either.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";

import type { Config } from "../config.js";
import type { HarnessName } from "../harness/registry.js";
import { RUNNER_ENTRY_URL } from "../runner-entry.js";
import { Peer, streamChannel, type LineChannel } from "./channel.js";
import {
  AGENT_HOST_CHANNEL_FD,
  AGENT_HOST_MODE_ARG,
  AGENT_HOST_PROTOCOL_VERSION,
  type HostCalls,
  type HostConfigWire,
  type HostNotices,
  type RunnerCalls,
  type RunnerNotices,
} from "./protocol.js";

/** The runner's side of the pipe. */
export type RunnerPeer = Peer<HostCalls, RunnerCalls, RunnerNotices, HostNotices>;

/** A started host: its channel, and how to end it if the channel's close does not. */
export interface StartedHost {
  readonly channel: LineChannel;
  readonly kill: () => void;
}

export type HostStarter = () => StartedHost | Promise<StartedHost>;

/** What the supervisor needs of the local proxy (`agent-proxy/server.ts`). */
export interface AgentProxyGate {
  /** `http://127.0.0.1:<port>`. */
  readonly endpoint: string;
  /** Make `token` the one host token the proxy accepts. */
  authorizeHost(token: string): void;
}

/**
 * The runner's handlers for one remote turn: what the host may ask while
 * the turn runs. `remote-adapter.ts` implements it.
 */
export interface RemoteTurnEndpoint {
  readonly calls: { readonly [M in keyof RunnerCalls]: (args: RunnerCalls[M]["args"]) => Promise<RunnerCalls[M]["result"]> };
  readonly notices: { readonly [M in keyof HostNotices]: (args: HostNotices[M]) => void };
}

export interface AgentHostSupervisorOptions {
  readonly start: HostStarter;
  readonly proxy: AgentProxyGate;
  readonly firstRestartDelayMs?: number;
  readonly maxRestartDelayMs?: number;
  /** How long a started host has to announce itself. */
  readonly helloTimeoutMs?: number;
  readonly log?: (message: string) => void;
}

const DEFAULT_HELLO_TIMEOUT_MS = 30_000;

/** A started, announced and booted host: its channel's peer, how to end it, when it started, and its token at the proxy. */
interface LiveHost {
  readonly peer: RunnerPeer;
  readonly kill: () => void;
  readonly startedAt: number;
  readonly token: string;
}

export class AgentHostSupervisor {
  private readonly booted = new Map<HarnessName, Config>();
  private readonly turns = new Map<string, RemoteTurnEndpoint>();
  private live: LiveHost | undefined;
  private starting: Promise<LiveHost> | undefined;
  private restartTimer: NodeJS.Timeout | undefined;
  private stopping = false;
  private nextDelay: number;
  private readonly firstDelay: number;
  private readonly maxDelay: number;
  private readonly log: (message: string) => void;

  constructor(private readonly options: AgentHostSupervisorOptions) {
    this.firstDelay = options.firstRestartDelayMs ?? 1000;
    this.maxDelay = options.maxRestartDelayMs ?? 30_000;
    this.nextDelay = this.firstDelay;
    this.log = options.log ?? ((message) => console.warn(message));
  }

  /** Boot `harness` in the host, starting the host first if it is not running. */
  async boot(harness: HarnessName, config: Config): Promise<void> {
    this.stopping = false;
    this.booted.set(harness, config);
    const { host, fresh } = await this.connectReporting();
    // A fresh host was booted with every recorded harness, this one included.
    if (!fresh) await host.peer.call("boot", { harness, config: this.wireConfig(config, host.token) });
  }

  /** Shut `harness` down in the host; the last one stops the host. */
  async shutdown(harness: HarnessName): Promise<void> {
    if (!this.booted.delete(harness)) return;
    const peer = this.live?.peer;
    try {
      if (peer && !peer.closed) await peer.call("shutdown", { harness });
    } finally {
      if (this.booted.size === 0) this.stop();
    }
  }

  async releaseSession(harness: HarnessName, sessionId: string): Promise<void> {
    const peer = this.live?.peer;
    // A host that is not running holds nothing for the session.
    if (peer && !peer.closed) await peer.call("releaseSession", { harness, sessionId });
  }

  /** The live host, started (and booted) first when it is not running. */
  async connection(): Promise<RunnerPeer> {
    return (await this.connectReporting()).host.peer;
  }

  /** Route the host's calls and notices for `turnId` to `endpoint` until the returned release runs. */
  attachTurn(turnId: string, endpoint: RemoteTurnEndpoint): () => void {
    this.turns.set(turnId, endpoint);
    return () => {
      this.turns.delete(turnId);
    };
  }

  private async connectReporting(): Promise<{ readonly host: LiveHost; readonly fresh: boolean }> {
    if (this.live && !this.live.peer.closed) return { host: this.live, fresh: false };
    this.starting ??= this.startHost().finally(() => {
      this.starting = undefined;
    });
    return { host: await this.starting, fresh: true };
  }

  private async startHost(): Promise<LiveHost> {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = undefined;
    }
    const token = randomBytes(32).toString("base64url");
    this.options.proxy.authorizeHost(token);
    const started = await this.options.start();
    const peer: RunnerPeer = new Peer<HostCalls, RunnerCalls, RunnerNotices, HostNotices>(started.channel, "runner");
    try {
      await this.awaitHello(peer);
      this.route(peer);
      for (const [harness, config] of this.booted) {
        await peer.call("boot", { harness, config: this.wireConfig(config, token) });
      }
      // The last harness shut down while this host started: end it, never adopt it.
      if (this.stopping) throw new Error("the agent host was stopped while it started");
    } catch (err) {
      peer.close();
      started.kill();
      throw err;
    }
    const startedAt = Date.now();
    const host: LiveHost = { peer, kill: started.kill, startedAt, token };
    this.live = host;
    peer.onClose((reason) => this.onHostGone(peer, startedAt, reason));
    return host;
  }

  private async awaitHello(peer: RunnerPeer): Promise<void> {
    const version = await peer.receivedHello(this.options.helloTimeoutMs ?? DEFAULT_HELLO_TIMEOUT_MS);
    if (version !== AGENT_HOST_PROTOCOL_VERSION) {
      throw new Error(`the agent host speaks protocol ${String(version)}; this runner speaks ${AGENT_HOST_PROTOCOL_VERSION}`);
    }
  }

  /** Install the dispatch of every host call and notice to the turn it names. */
  private route(peer: RunnerPeer): void {
    const endpointFor = (turnId: string): RemoteTurnEndpoint => {
      const endpoint = this.turns.get(turnId);
      if (!endpoint) throw new Error(`no turn ${turnId} is running on this runner`);
      return endpoint;
    };
    peer.handle("persist", async (args) => endpointFor(args.turnId).calls.persist(args));
    peer.handle("reportProgress", async (args) => endpointFor(args.turnId).calls.reportProgress(args));
    peer.handle("bindHarnessState", async (args) => endpointFor(args.turnId).calls.bindHarnessState(args));
    peer.handle("selectRecalledMemories", async (args) => endpointFor(args.turnId).calls.selectRecalledMemories(args));
    peer.handle("uploadArtifact", async (args) => endpointFor(args.turnId).calls.uploadArtifact(args));
    peer.handle("verifyPlugin", async (args) => endpointFor(args.turnId).calls.verifyPlugin(args));
    // A notice for a turn that already settled is late, and dropped.
    peer.onNotice("activity", (args) => this.turns.get(args.turnId)?.notices.activity(args));
    peer.onNotice("usage", (args) => this.turns.get(args.turnId)?.notices.usage(args));
    peer.onNotice("event", (args) => this.turns.get(args.turnId)?.notices.event(args));
    peer.onNotice("bindCas", (args) => this.turns.get(args.turnId)?.notices.bindCas(args));
  }

  /** The live host's channel closed. A host stopped on purpose is no longer live when its channel closes (`stop`), so this never restarts one. */
  private onHostGone(peer: RunnerPeer, startedAt: number, reason: Error): void {
    if (this.live?.peer !== peer) return;
    this.live.kill();
    this.live = undefined;
    if (Date.now() - startedAt > this.maxDelay) this.nextDelay = this.firstDelay;
    this.scheduleRestart(`exited (${reason.message})`);
  }

  private scheduleRestart(how: string): void {
    if (this.stopping) return;
    this.log(`[agent-host] the agent host ${how}; restarting in ${this.nextDelay}ms`);
    // A start (a turn's, or the next attempt's) and a stop each clear this
    // timer, so when it fires the host is neither running nor stopped.
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      this.connection().catch((err: unknown) => {
        this.scheduleRestart(`could not be started (${err instanceof Error ? err.message : String(err)})`);
      });
    }, this.nextDelay);
    this.restartTimer.unref();
    this.nextDelay = Math.min(this.nextDelay * 2, this.maxDelay);
  }

  private stop(): void {
    this.stopping = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = undefined;
    const live = this.live;
    this.live = undefined;
    if (live) {
      live.peer.close();
      live.kill();
    }
  }

  private wireConfig(config: Config, token: string): HostConfigWire {
    return {
      mode: config.mode,
      workspaceRootDir: config.workspaceRootDir,
      primaryModel: config.primaryModel,
      maxConcurrentActivities: config.maxConcurrentActivities,
      cloudModeEnabled: config.cloudModeEnabled,
      checkpointerType: config.checkpointerType,
      mcpBridgeEndpoint: config.mcpBridgeEndpoint,
      mcpPublicEndpoint: config.mcpPublicEndpoint,
      cursorStreamStallTimeoutMs: config.cursorStreamStallTimeoutMs,
      agentResolveTimeoutMs: config.agentResolveTimeoutMs,
      workspaceLockTimeoutMs: config.workspaceLockTimeoutMs,
      proxyEndpoint: this.options.proxy.endpoint,
      token,
      platformProxied: config.proxyEndpoint !== null,
    };
  }
}

/**
 * Start the host as a child process: this runner's own entry in its
 * agent-host mode (`main.ts`), on the same Node, with the channel on fd 3.
 * The host's stdout and stderr are relayed line by line through this
 * process's console, so its log lines read as the runner's always did and
 * never reach a stdout that carries the manager's protocol (`main.ts`
 * sends `console.log` to stderr in that mode).
 *
 * `env` is what the host and every process it starts see (`environment.ts`).
 */
export function processHostStarter(env: () => NodeJS.ProcessEnv): HostStarter {
  return () => {
    const { command, args } = agentHostCommand();
    return spawnHostProcess(command, args, env()).started;
  };
}

/**
 * Spawn one host process with its channel on fd 3 and its output relayed
 * (`processHostStarter` says how). The child is handed back beside the
 * started host for the spawned-host tests, which kill it mid-turn.
 */
export function spawnHostProcess(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): { readonly started: StartedHost; readonly child: ChildProcess } {
  const child: ChildProcess = spawn(command, args, {
    env,
    stdio: ["ignore", "pipe", "pipe", "pipe"],
  });
  // Piped above, so both streams exist.
  relayLines(child.stdout!, (line) => console.log(line));
  relayLines(child.stderr!, (line) => console.error(line));
  const pipe = child.stdio[AGENT_HOST_CHANNEL_FD] as Readable & Writable;
  const channel = streamChannel(pipe, pipe);
  child.on("exit", (code, signal) => channel.close(new Error(`agent host process ended (${signal ?? code})`)));
  child.on("error", (err) => channel.close(err));
  return {
    child,
    started: {
      channel,
      kill: () => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
      },
    },
  };
}

/** The command that runs this build's entry in its agent-host mode. */
export function agentHostCommand(): { readonly command: string; readonly args: readonly string[] } {
  const entry = fileURLToPath(RUNNER_ENTRY_URL);
  // Running from source (the tests' spawned hosts, `npm start`): the entry
  // is TypeScript, loaded the way the runner itself was.
  const loader = entry.endsWith(".ts") ? ["--import", "tsx"] : [];
  return { command: process.execPath, args: [...loader, entry, AGENT_HOST_MODE_ARG] };
}

function relayLines(stream: Readable, write: (line: string) => void): void {
  createInterface({ input: stream, crlfDelay: Infinity }).on("line", write);
}
