/**
 * The locked agent host: a second copy of the runner's own entry in its
 * agent-host mode, started under Node's permission model, which serves the
 * turns of conversations without a computer (`hosting.ts`).
 *
 * Such a turn has no tool that reaches a disk or runs a program; the lock
 * makes a bug in our code or a library fail loudly instead of doing either.
 * Node's documentation calls its permission model a seat belt for trusted
 * code, not a sandbox, and that is what it is here.
 *
 * What the lock grants, and nothing else: reading the install root
 * ({@link fenceReadRoot}), the folder that holds the entry and every package
 * the host loads at run time. No write, no child process, no worker thread,
 * no native addon, no WASI. A turn's reach is held by the runner's own checks
 * (`tools/url-guard.ts`, `shared/mcp-manager.ts`), not by Node: Node 22 has
 * no network permission, and a Node that has one (25 and later, where the
 * model refuses every socket unless granted) is given `--allow-net`, since
 * the host's every call (the local proxy, the platform's MCP lane, the
 * model) is a socket.
 *
 * The host proves its lock in its hello ({@link currentFence}): whether the
 * permission model is on, the flags it was started with, and Node's own
 * answers for the scopes Node documents. The runner accepts the hello only
 * when the lock is the one it built ({@link judgeFence}). `process.permission
 * .has` answers false for a scope Node does not know (an addon or WASI grant
 * cannot be asked for that way), so the flags themselves are the proof of
 * what was granted, and they must be exactly the runner's.
 *
 * A runner that cannot build the lock (a Node without the model, the runner
 * running from source under tsx, which needs writes and a worker) says so
 * with a {@link FenceRefusedError}, and its turns without a computer are
 * refused with that sentence rather than run unlocked.
 */

import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, parse, sep } from "node:path";

/** The lock as the host reports it in its hello (`protocol.ts` `HelloEnvelope`). */
export interface HostFenceReport {
  /** Whether `process.permission` exists: the permission model is on. */
  readonly permission: boolean;
  /** The host's own `process.execArgv`: the flags it was started with. */
  readonly execArgv: readonly string[];
  /** `process.permission.has("fs.read", <home>)`: true when the grant reaches the home folder. */
  readonly fsReadHome: boolean;
  readonly fsWrite: boolean;
  readonly childProcess: boolean;
  readonly worker: boolean;
}

/** The runner cannot run a turn without a computer locked; the message says why, in a sentence. */
export class FenceRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FenceRefusedError";
  }
}

/**
 * The packages the locked host loads at run time, besides its entry: the
 * Stigmer harness's engine, LangChain, the API stubs and Temporal's common
 * types. Found where Node would find them from the entry; a package the slim
 * bundle inlined is found nowhere and widens nothing.
 */
export const FENCED_HOST_PACKAGES: readonly string[] = ["deepagents", "@langchain/core", "@stigmer/apis", "@temporalio/common"];

/** The flag that turns the permission model on in this Node, or `null` when it has none. */
export function permissionFlag(allowed: ReadonlySet<string> = process.allowedNodeEnvironmentFlags): string | null {
  if (allowed.has("--permission")) return "--permission";
  if (allowed.has("--experimental-permission")) return "--experimental-permission";
  return null;
}

/** What {@link fenceReadRoot} needs of the filesystem; the tests lay out fixtures. */
export interface FenceRootIo {
  readonly exists: (path: string) => boolean;
  readonly realpath: (path: string) => string;
}

const REAL_IO: FenceRootIo = { exists: existsSync, realpath: (path) => realpathSync(path) };

/**
 * The one folder the locked host may read: the deepest common ancestor of
 * the entry's real folder and the real folder of each of `packages` found on
 * the entry's own `node_modules` lookup chain.
 *
 * Each package is found by walking the entry's ancestors for
 * `node_modules/<name>`, never through `require.resolve`, so a package whose
 * `exports` hides its `package.json` is still found. By shape: the slim
 * artifact holds everything it loads, so its own folder; the compiled build
 * in a checkout links the workspace packages into the repository, so the
 * repository root; a library embedder's install, the folder its
 * `node_modules` sits in.
 */
export function fenceReadRoot(entry: string, packages: readonly string[] = FENCED_HOST_PACKAGES, io: FenceRootIo = REAL_IO): string {
  const entryDir = io.realpath(dirname(entry));
  const roots = [entryDir];
  for (const name of packages) {
    const found = findOnLookupChain(entryDir, name, io);
    if (found !== undefined) roots.push(io.realpath(found));
  }
  return deepestCommonAncestor(roots);
}

function findOnLookupChain(from: string, name: string, io: FenceRootIo): string | undefined {
  let dir = from;
  for (;;) {
    const candidate = join(dir, "node_modules", ...name.split("/"));
    if (io.exists(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function deepestCommonAncestor(paths: readonly string[]): string {
  const { root } = parse(paths[0]!);
  const split = (path: string): string[] => path.slice(parse(path).root.length).split(sep).filter((s) => s !== "");
  let common = split(paths[0]!);
  for (const path of paths.slice(1)) {
    /* v8 ignore next -- @preserve: two roots happen only on Windows, between drive letters */
    if (parse(path).root !== root) return root;
    const segments = split(path);
    let n = 0;
    while (n < common.length && n < segments.length && common[n] === segments[n]) n++;
    common = common.slice(0, n);
  }
  return join(root, ...common);
}

/**
 * Where the locked host's LangSmith client looks for a profile, relative to
 * the install root: a name the runner never ships, inside the read grant.
 *
 * Why: LangChain builds a LangSmith run tree for every graph step, tracing
 * on or off, and its client probes `$HOME/.langsmith/config.json` with
 * `existsSync`. Under the lock that probe is not an answer but a throw
 * (ERR_ACCESS_DENIED: the home folder is outside the grant), which fails
 * every turn. `LANGSMITH_CONFIG_FILE` names the file it probes instead, and
 * a missing file inside the grant answers no.
 */
export const NO_LANGSMITH_PROFILE = ".stigmer-locked-host-no-langsmith-profile.json";

/** How the locked host is started: its Node flags, and what its environment needs beside the open host's. */
export interface FencedHostLaunch {
  /** The permission flag in the spelling this Node takes, one read grant of the install root, and the network where Node locks it. */
  readonly execArgv: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

/**
 * How the locked host is started (the module header). Throws a
 * {@link FenceRefusedError} where the lock cannot be built.
 */
export function fencedHostLaunch(
  entry: string,
  allowed: ReadonlySet<string> = process.allowedNodeEnvironmentFlags,
  readRoot: (entry: string) => string = fenceReadRoot,
): FencedHostLaunch {
  if (entry.endsWith(".ts")) {
    throw new FenceRefusedError(
      "the runner is running from source (TypeScript under tsx), which can't run under Node's permission model; run the built runner (`npm run build && node dist/main.js`)",
    );
  }
  const flag = permissionFlag(allowed);
  if (flag === null) throw new FenceRefusedError(`this Node (${process.version}) has no permission model`);
  const root = readRoot(entry);
  const net = allowed.has("--allow-net") ? ["--allow-net"] : [];
  return { execArgv: [flag, `--allow-fs-read=${root}`, ...net], env: { LANGSMITH_CONFIG_FILE: join(root, NO_LANGSMITH_PROFILE) } };
}

/** The environment names the locked host never starts with: Node's own options (nothing re-grants), and LangChain's tracer, which would try a worker thread ({@link fencedHostLaunch} sets the one LangSmith name it needs). */
function droppedFromFencedHost(name: string): boolean {
  return name === "NODE_OPTIONS" || name.startsWith("LANGSMITH_") || name.startsWith("LANGCHAIN_");
}

/** The locked host's environment: the open host's (`environment.ts`), less {@link droppedFromFencedHost}'s names. */
export function fencedHostEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !droppedFromFencedHost(name)));
}

/** What a process says of its lock: `process.permission`, when the model is on. */
interface PermissionApi {
  has(scope: string, reference?: string): boolean;
}

/** This process's lock, as the host reports it in its hello. */
export function currentFence(
  permission: PermissionApi | undefined = (process as { permission?: PermissionApi }).permission,
  execArgv: readonly string[] = process.execArgv,
  home: string = homedir(),
): HostFenceReport {
  // Without the model every scope is open.
  const has = (scope: string, reference?: string): boolean => (permission === undefined ? true : permission.has(scope, reference));
  return {
    permission: permission !== undefined,
    execArgv: [...execArgv],
    fsReadHome: has("fs.read", home),
    fsWrite: has("fs.write"),
    childProcess: has("child"),
    worker: has("worker"),
  };
}

/**
 * Whether a hello's fence is the lock the runner built: `null` when it is,
 * else the reason, in words. Read as the host sent it: the host is the
 * agent's side.
 */
export function judgeFence(report: unknown, expectedExecArgv: readonly string[]): string | null {
  if (report === null || typeof report !== "object") return "the agent program did not report its lock";
  const r = report as Partial<Record<keyof HostFenceReport, unknown>>;
  if (r.permission !== true) return "the agent program started without Node's permission model";
  const open: string[] = [];
  if (r.fsReadHome !== false) open.push("read the home folder");
  if (r.fsWrite !== false) open.push("write files");
  if (r.childProcess !== false) open.push("start processes");
  if (r.worker !== false) open.push("start worker threads");
  if (open.length > 0) return `the locked agent program may still ${open.join(", ")}`;
  const argv = Array.isArray(r.execArgv) ? r.execArgv : undefined;
  if (argv === undefined || argv.length !== expectedExecArgv.length || argv.some((flag, i) => flag !== expectedExecArgv[i])) {
    return `the agent program started with ${JSON.stringify(argv ?? null)}, not the lock the runner built (${JSON.stringify(expectedExecArgv)})`;
  }
  return null;
}
