/**
 * The runner's side of the agent host's lifetime: start it, prove it is the
 * host this build speaks to, boot the harnesses the runner asked for, route
 * its calls to the turns they belong to, and start it again when it dies.
 *
 * One supervisor per host, for the adapters' worker lifetime
 * (`harness/types.ts`): the open host, and one locked host per turn slot
 * for conversations without a computer (`hosting.ts`, `host-pool.ts`,
 * `fence.ts`). The manager mode's session workers share them, as they share
 * one adapter object in-process. The remote adapters (`remote-adapter.ts`)
 * and the locked hosts' pool are this module's only callers.
 *
 * A locked host's supervisor starts it on its slot's first turn where the
 * runner serves every conversation (`startOnFirstUse`), so a runner that
 * never serves such a turn pays nothing, and at boot where the runner serves
 * only conversations without a computer. It accepts the hello only when the
 * fence it reports is the one the starter built (`fence.ts` `judgeFence`).
 * A refused fence is final for the runner's life: one Node cannot grow a
 * lock later, so the refusal is logged once and every later turn reads it
 * at once ({@link FenceRefusedError}), with no host started to learn it
 * again.
 *
 * A locked host is started with a heap cap (`fence.ts`, the runner's turn
 * memory), and one that dies of it closes its channel with a
 * {@link HostHeapExhaustedError}: the turn it served settles with the
 * person's sentence (`remote-adapter.ts`), and only its own slot restarts.
 * The process's exit says so, read once the process has ended
 * ({@link spawnHostProcess}): V8 names heap exhaustion on stderr before it
 * aborts.
 *
 * Starting is a {@link HostStarter}: production spawns the runner's own
 * entry in its agent-host mode with the channel on fd 3
 * ({@link processHostStarter}); the tests serve a host in this process over
 * a loopback channel. Each start mints a fresh host token and authorizes it
 * at the local proxy (`agent-proxy/`) in its host's slot, so a token from a
 * host that died is worth nothing, and the other host's token stands.
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
import { existsSync, realpathSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";

import type { Config } from "../config.js";
import type { HarnessName } from "../harness/registry.js";
import { telemetrySettings } from "../otel-export.js";
import { RUNNER_ENTRY_URL } from "../runner-entry.js";
import { agentIdentity, programOnPath, setprivArgs, type AgentIdentity } from "../shared/agent-identity.js";
import { Peer, streamChannel, type LineChannel } from "./channel.js";
import { FenceRefusedError, fenceReadRoot, fencedHostLaunch, judgeFence } from "./fence.js";
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

/** A started host: its channel, how to end it if the channel's close does not, and the lock it was started under. */
export interface StartedHost {
  readonly channel: LineChannel;
  readonly kill: () => void;
  /** The Node flags of the lock the starter built (`fence.ts`); absent for an open host. */
  readonly execArgv?: readonly string[];
}

export type HostStarter = () => StartedHost | Promise<StartedHost>;

/** A host died of heap exhaustion: it grew past the cap it was started with (`fence.ts` `heapCapFlag`). */
export class HostHeapExhaustedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HostHeapExhaustedError";
  }
}

/** One host lent to one turn until `release` runs. */
export interface HostLease {
  readonly host: AgentHostSupervisor;
  release(): void;
}

/**
 * The hosts one side of the runner runs turns in: a single supervisor, whose
 * host serves every turn it is lent for at once, or the locked hosts' pool
 * (`host-pool.ts`), whose hosts each serve one turn at a time.
 */
export interface TurnHosts {
  boot(harness: HarnessName, config: Config): Promise<void>;
  shutdown(harness: HarnessName): Promise<void>;
  releaseSession(harness: HarnessName, sessionId: string): Promise<void>;
  /** A host for one turn; throws the {@link FenceRefusedError} that keeps a locked host from ever running here. */
  acquire(): Promise<HostLease>;
}

/** What the supervisor needs of the local proxy (`agent-proxy/server.ts`). */
export interface AgentProxyGate {
  /** `http://127.0.0.1:<port>`. */
  readonly endpoint: string;
  /** Make `token` the one token the proxy accepts for the host in `slot`, beside the other slot's. */
  authorizeHost(slot: string, token: string): void;
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
  /** The host's slot at the proxy; `"open"` by default. */
  readonly slot?: string;
  /** Accept a hello only with the fence the starter built (`fence.ts`), and refuse for good when it is not. */
  readonly fenced?: boolean;
  /** Record booted harnesses and start the host at its first use, never at boot. */
  readonly startOnFirstUse?: boolean;
  /** The heap cap the starter starts the host under, in megabytes: what a turn that outgrows it is told. */
  readonly heapMb?: number;
}

const DEFAULT_HELLO_TIMEOUT_MS = 30_000;

/** A started, announced and booted host: its channel's peer, how to end it, when it started, and its token at the proxy. */
interface LiveHost {
  readonly peer: RunnerPeer;
  readonly kill: () => void;
  readonly startedAt: number;
  readonly token: string;
}

export class AgentHostSupervisor implements TurnHosts {
  private readonly booted = new Map<HarnessName, Config>();
  private readonly turns = new Map<string, RemoteTurnEndpoint>();
  private live: LiveHost | undefined;
  private starting: Promise<LiveHost> | undefined;
  private restartTimer: NodeJS.Timeout | undefined;
  private stopping = false;
  /** Why a locked host can never run on this runner, once that is known. */
  private refused: FenceRefusedError | undefined;
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

  /** Boot `harness` in the host, starting the host first if it is not running (or recording it for the first use). */
  async boot(harness: HarnessName, config: Config): Promise<void> {
    this.stopping = false;
    this.booted.set(harness, config);
    // A host started at first use is booted then with every recorded harness.
    if (this.options.startOnFirstUse && !(this.live && !this.live.peer.closed)) return;
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

  /** The host's slot at the local proxy. */
  get slot(): string {
    return this.options.slot ?? "open";
  }

  /** The heap cap the host runs under, in megabytes; undefined for a host started without one. */
  get heapMb(): number | undefined {
    return this.options.heapMb;
  }

  /** Why a locked host can never run on this runner, once a start has learned it. */
  get refusal(): FenceRefusedError | undefined {
    return this.refused;
  }

  /** This host, for one turn: it serves every turn it is lent for at once. */
  async acquire(): Promise<HostLease> {
    return { host: this, release: () => {} };
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
    if (this.refused) throw this.refused;
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
    this.options.proxy.authorizeHost(this.options.slot ?? "open", token);
    let started: StartedHost;
    try {
      started = await this.options.start();
    } catch (err) {
      throw this.refuseFor(err);
    }
    const peer: RunnerPeer = new Peer<HostCalls, RunnerCalls, RunnerNotices, HostNotices>(started.channel, "runner");
    try {
      await this.awaitHello(peer, started);
      this.route(peer);
      for (const [harness, config] of this.booted) {
        await peer.call("boot", { harness, config: this.wireConfig(config, token) });
      }
      // The last harness shut down while this host started: end it, never adopt it.
      if (this.stopping) throw new Error("the agent host was stopped while it started");
    } catch (err) {
      // A locked host that ends before it announces itself cannot run here
      // (a read grant too narrow, a Node that refuses the flags): its own
      // error is in the log, relayed from its stderr.
      const diedUnannounced = this.options.fenced === true && peer.closed && peer.hello["protocolVersion"] === undefined;
      peer.close();
      started.kill();
      throw this.refuseFor(
        diedUnannounced ? new FenceRefusedError(`the locked agent program exited before it started (${err instanceof Error ? err.message : String(err)})`) : err,
      );
    }
    const startedAt = Date.now();
    // Said once per start, so an operator (and the execution conformance lane) can see that turns without a computer run locked.
    if (this.options.fenced) this.log(`[agent-host] the locked agent host started (${(started.execArgv ?? []).join(" ")})`);
    const host: LiveHost = { peer, kill: started.kill, startedAt, token };
    this.live = host;
    peer.onClose((reason) => this.onHostGone(peer, startedAt, reason));
    return host;
  }

  private async awaitHello(peer: RunnerPeer, started: StartedHost): Promise<void> {
    const version = await peer.receivedHello(this.options.helloTimeoutMs ?? DEFAULT_HELLO_TIMEOUT_MS);
    if (version !== AGENT_HOST_PROTOCOL_VERSION) {
      throw new Error(`the agent host speaks protocol ${String(version)}; this runner speaks ${AGENT_HOST_PROTOCOL_VERSION}`);
    }
    if (!this.options.fenced) return;
    const refusal =
      started.execArgv === undefined ? "the agent program was started without a lock" : judgeFence(peer.hello["fence"], started.execArgv);
    if (refusal !== null) throw new FenceRefusedError(refusal);
  }

  /** `err`, made final for the runner's life when it is a fence refusal, and logged once. */
  private refuseFor(err: unknown): unknown {
    if (!(err instanceof FenceRefusedError)) return err;
    if (!this.refused) {
      this.refused = err;
      this.log(`[agent-host] the locked agent host can't run on this runner, so it refuses turns without a computer: ${err.message}`);
    }
    return this.refused;
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
    peer.handle("selectRecalledMemories", async (args) => endpointFor(args.turnId).calls.selectRecalledMemories(args));
    peer.handle("verifyPlugin", async (args) => endpointFor(args.turnId).calls.verifyPlugin(args));
    peer.handle("listTurnArchives", async (args) => endpointFor(args.turnId).calls.listTurnArchives(args));
    peer.handle("readTurnArchiveFile", async (args) => endpointFor(args.turnId).calls.readTurnArchiveFile(args));
    peer.handle("listTurnInputs", async (args) => endpointFor(args.turnId).calls.listTurnInputs(args));
    peer.handle("readTurnInput", async (args) => endpointFor(args.turnId).calls.readTurnInput(args));
    peer.handle("listTurnOutputs", async (args) => endpointFor(args.turnId).calls.listTurnOutputs(args));
    peer.handle("readTurnOutput", async (args) => endpointFor(args.turnId).calls.readTurnOutput(args));
    peer.handle("writeTurnOutput", async (args) => endpointFor(args.turnId).calls.writeTurnOutput(args));
    peer.handle("deleteTurnOutput", async (args) => endpointFor(args.turnId).calls.deleteTurnOutput(args));
    peer.handle("putTurnOffload", async (args) => endpointFor(args.turnId).calls.putTurnOffload(args));
    peer.handle("readTurnOffload", async (args) => endpointFor(args.turnId).calls.readTurnOffload(args));
    peer.handle("checkpointRows", async (args) => endpointFor(args.turnId).calls.checkpointRows(args));
    peer.handle("claimInput", async (args) => endpointFor(args.turnId).calls.claimInput(args));
    peer.handle("claimedInput", async (args) => endpointFor(args.turnId).calls.claimedInput(args));
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
    if (this.stopping || this.refused) return;
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
      checkpointerType: config.checkpointerType,
      mcpBridgeEndpoint: config.mcpBridgeEndpoint,
      mcpPublicEndpoint: config.mcpPublicEndpoint,
      cursorStreamStallTimeoutMs: config.cursorStreamStallTimeoutMs,
      openOperationMaxMs: config.openOperationMaxMs,
      shellTimeoutMaxSeconds: config.shellTimeoutMaxSeconds,
      shellBackgroundEnabled: config.shellBackgroundEnabled,
      workspaceLockTimeoutMs: config.workspaceLockTimeoutMs,
      proxyEndpoint: this.options.proxy.endpoint,
      token,
      platformProxied: config.proxyEndpoint !== null,
      telemetry: telemetrySettings(),
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
export function processHostStarter(env: () => NodeJS.ProcessEnv, options: { readonly fenced?: boolean; readonly heapMb?: number } = {}): HostStarter {
  return () => {
    const { command, args, env: runtimeEnv, execArgv } = agentHostCommand(process.versions, agentIdentity(), process.env.PATH ?? "", options);
    const { started } = spawnHostProcess(command, args, { ...env(), ...runtimeEnv });
    return execArgv === undefined ? started : { ...started, execArgv };
  };
}

/** How long a host whose pipe has closed has to exit before it is killed: its own shutdown grace (`entry.ts`), and a margin. */
export const HOST_KILL_GRACE_MS = 15_000;

/** How long a host's broken pipe waits for the process's exit, which says why it ended, before the channel closes without it. */
export const HOST_EXIT_REASON_WAIT_MS = 2_000;

/** What V8 writes on stderr when a process dies of heap exhaustion ("FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory"). */
const HEAP_EXHAUSTED_LINE = /JavaScript heap out of memory/;

/**
 * Spawn one host process with its channel on fd 3 and its output relayed
 * (`processHostStarter` says how). The child is handed back beside the
 * started host for the spawned-host tests, which kill it mid-turn.
 *
 * fd 3 is `"overlapped"`, not `"pipe"`: on Windows a `"pipe"` hands the child
 * a synchronous handle, on which libuv runs a read and a write on worker
 * threads that block each other, so the host's hello waits behind its own
 * pending read while this side waits for the hello (#2983). Overlapped I/O
 * lets both run at once. Everywhere else Node treats the two types the
 * same. stdout and stderr only flow one way, so they stay `"pipe"`.
 *
 * A pipe that ends on its own (the process died) closes the channel with
 * the process's exit, read once the process and its output have ended: a
 * {@link HostHeapExhaustedError} when V8 said the heap ran out, else the
 * code or signal. The pipe usually ends before the exit is known, so the
 * channel waits for it, at most {@link HOST_EXIT_REASON_WAIT_MS}. A close
 * the runner asks for is at once.
 */
export function spawnHostProcess(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  killGraceMs: number = HOST_KILL_GRACE_MS,
): { readonly started: StartedHost; readonly child: ChildProcess } {
  const child: ChildProcess = spawn(command, args, {
    env,
    stdio: ["ignore", "pipe", "pipe", "overlapped"],
  });
  // Piped above, so both streams exist.
  let heapExhausted = false;
  relayLines(child.stdout!, (line) => console.log(line));
  relayLines(child.stderr!, (line) => {
    if (HEAP_EXHAUSTED_LINE.test(line)) heapExhausted = true;
    console.error(line);
  });
  const pipe = child.stdio[AGENT_HOST_CHANNEL_FD] as Readable & Writable;
  // "close" follows the exit and the end of every stream, so stderr has been read whole.
  const exited = new Promise<Error>((resolve) => {
    child.once("close", (code, signal) => {
      const how = signal ?? code;
      resolve(heapExhausted ? new HostHeapExhaustedError(`agent host process ran out of memory (${how})`) : new Error(`agent host process ended (${how})`));
    });
  });
  const channel = closedWithExitReason(streamChannel(pipe, pipe), exited, HOST_EXIT_REASON_WAIT_MS);
  child.on("error", (err) => channel.close(err));
  return {
    child,
    started: {
      channel,
      // The host ignores SIGTERM and exits when its pipe closes, after its
      // adapters' shutdown (`entry.ts`); one that has not exited a grace
      // later is wedged, and is killed.
      kill: () => {
        if (child.exitCode !== null || child.signalCode !== null) return;
        const timer = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        }, killGraceMs);
        timer.unref();
        child.once("exit", () => clearTimeout(timer));
      },
    },
  };
}

/**
 * The command that runs this build's entry in its agent-host mode, and what
 * its environment needs for that runtime: under Electron (a library
 * embedder's), `process.execPath` is the Electron binary, which runs a script
 * as Node only with `ELECTRON_RUN_AS_NODE`. The host drops it again at
 * start (`entry.ts`), so an Electron app an agent runs behaves as usual.
 *
 * A separating runner (`shared/agent-identity.ts`) starts it through
 * `setpriv` as the agent user, with the agent's home as `HOME`: the one
 * place the runner drops privilege. Everything the host starts inherits it.
 *
 * `fenced` starts the locked host (`fence.ts`): the same entry under Node's
 * permission model, granted only a read of its install root and capped at
 * `heapMb` of heap where one is given, with `execArgv` naming those flags
 * for the hello's check. It throws a
 * `FenceRefusedError`, spawning nothing, where the lock cannot be built: a
 * Node without the model, or the runner running from source under tsx.
 * Where the runner separates, the locked host is the agent user too.
 */
export function agentHostCommand(
  versions: NodeJS.ProcessVersions = process.versions,
  identity: AgentIdentity | null = agentIdentity(),
  runnerPath: string = process.env.PATH ?? "",
  options: { readonly fenced?: boolean; readonly entry?: string; readonly heapMb?: number } = {},
): {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly execArgv?: readonly string[];
} {
  const named = options.entry ?? fileURLToPath(RUNNER_ENTRY_URL);
  // The locked host is handed its entry's real path: Node resolves the path
  // it is given component by component, and a link on the way (macOS's
  // `/var`, an install behind a symlink) sits outside the one read grant.
  const entry = options.fenced && existsSync(named) ? realpathSync(named) : named;
  const fence = options.fenced ? fencedHostLaunch(entry, process.allowedNodeEnvironmentFlags, fenceReadRoot, options.heapMb) : undefined;
  // Running from source (the tests' spawned hosts, `npm start`): the entry
  // is TypeScript, loaded the way the runner itself was. A locked host never
  // runs from source (`fencedHostLaunch` refuses it above).
  const loader = entry.endsWith(".ts") ? ["--import", "tsx"] : [];
  const node = [process.execPath, ...(fence?.execArgv ?? []), ...loader, entry, AGENT_HOST_MODE_ARG];
  const withFence = fence === undefined ? {} : { execArgv: fence.execArgv };
  const runtime: Readonly<Record<string, string>> = {
    ...(versions.electron === undefined ? {} : { ELECTRON_RUN_AS_NODE: "1" }),
    ...(fence?.env ?? {}),
  };
  if (identity === null) return { command: node[0]!, args: node.slice(1), env: runtime, ...withFence };
  // By its absolute path on the runner's own PATH, never a bare name: the
  // host's environment may lead with the agent's install folders
  // (agent-host/environment.ts), and the spawn would resolve a bare name
  // through it, starting an agent-planted program as root.
  const setpriv = programOnPath("setpriv", runnerPath);
  if (setpriv === undefined) {
    throw new Error("the runner's PATH has no setpriv, so the agent host cannot start as the agent");
  }
  return { command: setpriv, args: [...setprivArgs(identity), "--", ...node], env: { ...runtime, HOME: identity.home }, ...withFence };
}

/**
 * `inner`, whose close reports the process's exit when the pipe ended on its
 * own ({@link spawnHostProcess}); a close the runner asks for reports at once.
 */
function closedWithExitReason(inner: LineChannel, exited: Promise<Error>, waitMs: number): LineChannel {
  const listeners: ((reason: Error) => void)[] = [];
  let reported = false;
  let closedByRunner = false;
  const report = (reason: Error): void => {
    if (reported) return;
    reported = true;
    for (const listener of listeners) listener(reason);
  };
  inner.onClose((reason) => {
    if (closedByRunner) return report(reason);
    const timer = setTimeout(() => report(reason), waitMs);
    timer.unref();
    void exited.then((exitReason) => {
      clearTimeout(timer);
      report(exitReason);
    });
  });
  // A process that ended with its pipe still open (a grandchild holding it) closes the channel too.
  void exited.then((exitReason) => inner.close(exitReason));
  return {
    send: (line) => inner.send(line),
    onLine: (listener) => inner.onLine(listener),
    onClose: (listener) => {
      listeners.push(listener);
    },
    close: (reason) => {
      closedByRunner = true;
      inner.close(reason);
    },
  };
}

function relayLines(stream: Readable, write: (line: string) => void): void {
  createInterface({ input: stream, crlfDelay: Infinity }).on("line", write);
}
