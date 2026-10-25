/**
 * The platform's read-only `.stigmer/` mount inside the native agent's
 * virtual filesystem.
 *
 * WHY A ROUTE, NOT THE SYMLINK
 * ----------------------------
 * Platform content — resolved skills, attached inputs, the approved plan —
 * lives in the session's platform dir, outside the workspace, and reaches the
 * agent at `.stigmer/…` (`shared/workspace/stigmer-link.ts`). The Cursor SDK
 * and the shell follow the workspace's `.stigmer` symlink to it. The native
 * file tools cannot: deepagents (since 1.14) resolves every path of a
 * `virtualMode` backend to its REAL location and refuses one that lands
 * outside the root ("Path '…' resolves outside root directory",
 * `FilesystemBackend.assertRealPathWithinRoot`), and every backend the native
 * harness builds is virtual-rooted (`cas-capture-backend.ts`, issue #754).
 * Turning that confinement off would reopen the escape it closes, so the
 * platform dir is mounted instead through deepagents' own router,
 * `CompositeBackend`, at exactly the prefix the prompts name.
 *
 * WHY READ-ONLY, BUT FOR THE OUTPUTS FOLDER
 * -----------------------------------------
 * Nothing legitimately writes platform content from a turn: skills and
 * inputs are presented as read-only and plan mode denies every write. A
 * writable mount would also be dangerous and unreviewed: `CompositeBackend.delete`
 * fans a delete out to every route beneath its target, so a delete of `/` or
 * of `/.stigmer` would empty the platform dir, and a routed write would reach
 * the platform dir without passing the CAS observer that file review reads.
 * Every mutation through the mount therefore fails, which also makes the
 * composite refuse any fan-out that touches it.
 *
 * The one exception is `.stigmer/outputs/` ({@link OUTPUTS_ROUTE_PREFIX}):
 * the agent's own deliverables, which the runtime returns to the person as
 * Files when the turn ends (`shared/outputs.ts`). It is a route of its own,
 * longer than the platform's, and `CompositeBackend` routes a path to the
 * longest prefix that holds it, so every path under it reaches
 * {@link OutputsBackend} and every other path under `.stigmer/` still
 * reaches the read-only one. Writes, edits and deletes inside it are
 * allowed; a delete of the folder itself is refused, so it is never emptied
 * whole or removed. A delete of `/` or `/.stigmer` still stops at the first
 * refusal: the composite asks the path's own backend first (the workspace's
 * or the read-only platform's) and stops there, before the outputs route
 * beneath it. Outputs are deliberately outside file review: they come back
 * as Files, so a review would hold nothing the person does not already get.
 *
 * WHERE DEEPAGENTS' OFFLOADS GO
 * -----------------------------
 * deepagents writes two kinds of file through the agent's backend from its
 * own middleware: tool results too large to keep in context
 * ({@link DEEPAGENTS_OFFLOAD_ROOT}) and, at every compaction, the summarized
 * conversation ({@link DEEPAGENTS_HISTORY_ROOT}), each time telling the model
 * it can `read_file` them back. They are the runner's scratch, not the
 * person's work, so each root is a route of its own to the session's offload
 * directory (`shared/workspace/platform-dir.ts`, beside the platform dir and
 * outside the workspace), an {@link OffloadBackend} each, where
 * "attaching a real repo never leaves Stigmer files behind in it" holds for
 * them too (`platform-dir.ts`); through the workspace backend they were
 * top-level directories of the person's tree. The runner keeps a long tool
 * result under the first root too, by the same name, through the same route
 * (`middleware/tool-truncation.ts`, which writes only through a backend
 * {@link routesOffloads} admits). Routed, they bypass the CAS
 * observer and live outside the work tree, as the outputs folder does. The two roots are left out of the root listing, as
 * an empty route is: deepagents names them to the model itself. A
 * repository's own real directory of either name is behind the route and
 * unreachable to the file tools, as a real `.stigmer` is; the shell still
 * sees it.
 *
 * WHEN IT IS MOUNTED
 * ------------------
 * On every turn: `.stigmer/` is the platform's name whether or not the turn
 * mounted anything, so a write there never reaches the workspace. Before
 * #1123 the route existed only on linked turns, and a write under `.stigmer/`
 * on any other turn made a real directory in the user's tree that the next
 * link displaced. What the route exposes follows the link, so the file tools
 * reach exactly what the shell reaches on the same turn:
 * - when the link points at the platform dir, the platform dir
 *   ({@link PlatformContentBackend}) and its outputs folder. The runtime
 *   links every turn of a session with a platform dir, since the outputs
 *   folder is there on every turn, and holds the dir to this turn's own
 *   skills and plugins (`harness/run-turn.ts`, its outputs phase);
 * - otherwise, nothing ({@link NoPlatformContentBackend}): a turn the link
 *   could not be made on reaches nothing through the shell either. The root
 *   listing then leaves `.stigmer/` out, as the tree does.
 * Shell commands (a skill's own scripts among them) run in the workspace
 * and resolve `.stigmer/…` through the link.
 */

import { join, posix } from "node:path";
import { CompositeBackend, FilesystemBackend } from "deepagents";
import type {
  AnyBackendProtocol,
  BackendProtocolV2,
  DeleteResult,
  EditResult,
  FileDownloadResponse,
  FileUploadResponse,
  GlobResult,
  GrepResult,
  LsResult,
  ReadRawResult,
  ReadResult,
  WriteResult,
} from "deepagents";
import { OUTPUTS_SUBDIR } from "../../shared/outputs.js";
import { STIGMER_LOCAL_STATE_DIR, stigmerSymlinkPointsAt } from "../../shared/workspace/stigmer-link.js";
import { offloadDirBeside } from "../../shared/workspace/platform-dir.js";
import { backgroundOutputFileName, type BackgroundOutputPaths } from "../../shared/shell/background-commands.js";
import { agentFs } from "../../shared/agent-fs.js";
import { editLoosely } from "./loose-edit.js";

/** The route prefix, with the trailing slash `CompositeBackend` needs to match `/.stigmer/x` but never `/.stigmerx`. */
export const PLATFORM_ROUTE_PREFIX = `/${STIGMER_LOCAL_STATE_DIR}/`;

/** The outputs folder's route: longer than the platform's, so every path under it is routed here. */
export const OUTPUTS_ROUTE_PREFIX = `${PLATFORM_ROUTE_PREFIX}${OUTPUTS_SUBDIR}/`;

/**
 * Where deepagents (1.14) writes a tool result too large to keep in context,
 * telling the model to `read_file` it back. Not exported by deepagents; the
 * literal is its filesystem middleware's. Routed to the session's offload
 * directory (the header).
 */
export const DEEPAGENTS_OFFLOAD_ROOT = "/large_tool_results/";

/**
 * Where deepagents (1.14) evicts a long human message and the summarized
 * conversation, telling the model it can `read_file` them back. Not exported
 * by deepagents; the literal is its filesystem and summarization middleware's.
 * Routed to the session's offload directory (the header).
 */
export const DEEPAGENTS_HISTORY_ROOT = "/conversation_history/";

/** deepagents' two offload roots, each routed to its own directory in the session's offload directory (the header). */
export const OFFLOAD_ROUTE_PREFIXES: readonly string[] = [DEEPAGENTS_OFFLOAD_ROOT, DEEPAGENTS_HISTORY_ROOT];

/**
 * What `read_file` may still read when an agent's tool lists exclude `Read`
 * (`middleware/tool-scope.ts`): the platform's own content and what deepagents
 * offloads from the agent's own turn, never the workspace. Each is a route
 * of its own to a virtual-rooted backend outside the workspace (the header),
 * which refuses a path that resolves out of its root, so a canonical path
 * under one is admitted by its prefix. The path is what the tool sees after
 * path normalization; a `..` is resolved before the prefix is read.
 */
export async function admitsRoutedRead(virtualPath: string): Promise<boolean> {
  if (!virtualPath.startsWith("/")) return false;
  const normalized = posix.normalize(virtualPath);
  return [PLATFORM_ROUTE_PREFIX, ...OFFLOAD_ROUTE_PREFIXES].some((prefix) => normalized.startsWith(prefix));
}

/** The path as the agent named it: the route hands its backend the path with the prefix stripped. */
function agentPath(routedPath: string, prefix = PLATFORM_ROUTE_PREFIX): string {
  return `${prefix.slice(0, -1)}${routedPath}`;
}

function readOnly(routedPath: string): string {
  return (
    `Error: '${agentPath(routedPath)}' is platform content (skills, attached inputs, the approved plan) ` +
    `and is read-only; write your own files in the workspace, or save a result for the user in ${OUTPUTS_ROUTE_PREFIX.slice(1)}`
  );
}

function noPlatformContent(routedPath: string): string {
  return (
    `Error: '${agentPath(routedPath)}' does not exist: this turn has no platform content ` +
    "(no skills or attached inputs)"
  );
}

/** The platform dir, virtual-rooted like every native backend, refusing every mutation. */
export class PlatformContentBackend extends FilesystemBackend {
  constructor(platformDir: string) {
    super({ rootDir: platformDir, virtualMode: true });
  }

  override async write(filePath: string): Promise<WriteResult> {
    return { error: readOnly(filePath) };
  }

  override async edit(filePath: string): Promise<EditResult> {
    return { error: readOnly(filePath) };
  }

  override async delete(filePath: string): Promise<DeleteResult> {
    return { error: readOnly(filePath) };
  }

  override async uploadFiles(files: Array<[string, Uint8Array]>): Promise<FileUploadResponse[]> {
    return files.map(([path]) => ({ path, error: "permission_denied" }));
  }
}

/**
 * The outputs folder, virtual-rooted like every native backend: the agent
 * writes, edits and deletes inside it as in the workspace, an edit quoted
 * loosely landing as it does there (`loose-edit.ts`), and the folder itself is
 * never deleted (the module header).
 */
export class OutputsBackend extends FilesystemBackend {
  constructor(outputsDir: string) {
    super({ rootDir: outputsDir, virtualMode: true });
  }

  override async edit(
    filePath: string,
    oldString: string,
    newString: string,
    replaceAll?: boolean,
  ): Promise<EditResult> {
    return editLoosely(this, filePath, oldString, newString, replaceAll, (exactOld, exactNew) =>
      super.edit(filePath, exactOld, exactNew, replaceAll),
    );
  }

  override async delete(filePath: string): Promise<DeleteResult> {
    if (posix.normalize(filePath) === "/") {
      return {
        error:
          `Error: '${agentPath("/", OUTPUTS_ROUTE_PREFIX)}' is the outputs folder and stays; ` +
          "delete the files inside it instead",
      };
    }
    return super.delete(filePath);
  }
}

/**
 * One of deepagents' offload roots, in the session's offload directory:
 * virtual-rooted like every native backend, writable, and never deleted
 * whole (the outputs folder's rule), so a fan-out delete of `/` never
 * empties it.
 */
export class OffloadBackend extends FilesystemBackend {
  constructor(
    private readonly prefix: string,
    dir: string,
  ) {
    super({ rootDir: dir, virtualMode: true });
  }

  override async delete(filePath: string): Promise<DeleteResult> {
    if (posix.normalize(filePath) === "/") {
      return {
        error:
          `Error: '${agentPath("/", this.prefix)}' holds what this turn offloaded from its context and stays; ` +
          "delete the files inside it instead",
      };
    }
    return super.delete(filePath);
  }
}

/**
 * The `.stigmer/` route on a turn that exposes no platform content: nothing
 * to read, list or find, and every mutation refused with the same message
 * the platform dir's route gives. It stands on no filesystem, so it cannot
 * create or reveal anything, and `ls` answers "does not exist" rather than
 * an empty listing because the root listing leaves `.stigmer/` out.
 */
export class NoPlatformContentBackend implements BackendProtocolV2 {
  ls(path: string): LsResult {
    return { error: noPlatformContent(path) };
  }

  read(filePath: string): ReadResult {
    return { error: noPlatformContent(filePath) };
  }

  readRaw(filePath: string): ReadRawResult {
    return { error: noPlatformContent(filePath) };
  }

  grep(): GrepResult {
    return { matches: [] };
  }

  glob(): GlobResult {
    return { files: [] };
  }

  write(filePath: string): WriteResult {
    return { error: readOnly(filePath) };
  }

  edit(filePath: string): EditResult {
    return { error: readOnly(filePath) };
  }

  delete(filePath: string): DeleteResult {
    return { error: readOnly(filePath) };
  }

  uploadFiles(files: Array<[string, Uint8Array]>): FileUploadResponse[] {
    return files.map(([path]) => ({ path, error: "permission_denied" }));
  }

  downloadFiles(paths: string[]): FileDownloadResponse[] {
    return paths.map((path) => ({ path, content: null, error: "file_not_found" }));
  }
}

/**
 * The workspace backend with `.stigmer/` routed to {@link PLATFORM_ROUTE_PREFIX}'s
 * backend for this turn, when the platform is exposed `.stigmer/outputs/`
 * to {@link OutputsBackend}, and deepagents' offload roots to their
 * {@link OffloadBackend}s.
 *
 * One behaviour differs from the stock router: listing `/`. The composite
 * adds each route to the root listing whatever the route holds. With the
 * platform exposed, the workspace backend also lists `.stigmer/` by following
 * the link, so the stock listing names the same directory twice and is
 * de-duplicated by path. With nothing exposed, `.stigmer/` is left out of the
 * root listing altogether: the route has nothing to show, and a real
 * `.stigmer` the workspace may hold is unreachable behind it. The offload
 * roots are always left out of it (the header).
 */
export class PlatformRoutedBackend extends CompositeBackend {
  private readonly exposesPlatform: boolean;
  /** Holds the {@link DEEPAGENTS_OFFLOAD_ROOT} route; read through {@link routesOffloads}. */
  readonly routesToolResults: boolean;

  constructor(
    backend: AnyBackendProtocol,
    platform: PlatformContentBackend | NoPlatformContentBackend,
    outputs?: OutputsBackend,
    offloads: Readonly<Record<string, OffloadBackend>> = {},
  ) {
    super(backend, {
      [PLATFORM_ROUTE_PREFIX]: platform,
      ...(outputs === undefined ? {} : { [OUTPUTS_ROUTE_PREFIX]: outputs }),
      ...offloads,
    });
    this.exposesPlatform = platform instanceof PlatformContentBackend;
    this.routesToolResults = DEEPAGENTS_OFFLOAD_ROOT in offloads;
  }

  override async ls(path: string): Promise<LsResult> {
    const result = await super.ls(path);
    if (path !== "/" || !result.files) return result;
    const hidden = new Set(OFFLOAD_ROUTE_PREFIXES);
    if (!this.exposesPlatform) hidden.add(PLATFORM_ROUTE_PREFIX);
    const seen = new Set<string>();
    return {
      ...result,
      files: result.files.filter((entry) => {
        if (hidden.has(entry.path) || seen.has(entry.path)) return false;
        seen.add(entry.path);
        return true;
      }),
    };
  }
}

/**
 * Whether a write under {@link DEEPAGENTS_OFFLOAD_ROOT} through `backend` lands
 * in the session's offload directory, never the workspace: true only for a
 * routed backend holding that route, which both of {@link mountPlatformRoute}'s
 * constructions pass. The runner's own keeping of long tool results
 * (`middleware/tool-truncation.ts`) writes through a backend only when this
 * holds; the class alone does not prove the route, since `offloads` defaults
 * to none.
 */
export function routesOffloads(backend: AnyBackendProtocol): boolean {
  return backend instanceof PlatformRoutedBackend && backend.routesToolResults;
}

export interface PlatformRouteOptions {
  /** The workspace root the backend is rooted at (where the link lives). */
  readonly workspaceDir: string;
  /** The session's platform dir; absent when the session has none. */
  readonly platformDir: string | undefined;
}

/**
 * Mount the `.stigmer/` route over `backend` for this turn: the platform dir
 * and its writable outputs folder when the workspace link points at it, the
 * empty route otherwise; and, either way, deepagents' offload roots, each in
 * the session's offload directory (created here). Only a session without a
 * platform dir gets `backend` back unchanged. `execute`
 * and the sandbox identity stay the workspace backend's (`CompositeBackend`
 * delegates both to its default), so a shell-capable graph keeps its
 * `execute` tool and a plan-mode graph stays without one.
 */
export async function mountPlatformRoute(
  backend: AnyBackendProtocol,
  options: PlatformRouteOptions,
): Promise<AnyBackendProtocol> {
  const { workspaceDir, platformDir } = options;
  if (platformDir === undefined) return backend;
  const offloads = await offloadRoutes(offloadDirBeside(platformDir));
  if (!(await stigmerSymlinkPointsAt(workspaceDir, platformDir))) {
    return new PlatformRoutedBackend(backend, new NoPlatformContentBackend(), undefined, offloads);
  }
  return new PlatformRoutedBackend(
    backend,
    new PlatformContentBackend(platformDir),
    new OutputsBackend(join(platformDir, OUTPUTS_SUBDIR)),
    offloads,
  );
}

/**
 * Where a command the agent runs in the background writes its output
 * (`shared/shell/background-commands.ts`): beside the results deepagents
 * offloads, under {@link DEEPAGENTS_OFFLOAD_ROOT}, so `read_file` reads it
 * like any kept result, outside the workspace and file review, even where
 * the agent's lists exclude `Read` (`admitsRoutedRead`). Undefined for a
 * session without a platform dir, which has no offload route.
 */
export function backgroundOutputPathsIn(platformDir: string | undefined): BackgroundOutputPaths | undefined {
  if (platformDir === undefined) return undefined;
  const dir = join(offloadDirBeside(platformDir), DEEPAGENTS_OFFLOAD_ROOT.slice(1, -1));
  return {
    virtual: (id) => `${DEEPAGENTS_OFFLOAD_ROOT}${backgroundOutputFileName(id)}`,
    real: (id) => join(dir, backgroundOutputFileName(id)),
  };
}

/** One {@link OffloadBackend} per offload root, each in its own directory of the session's offload directory. */
async function offloadRoutes(offloadDir: string): Promise<Record<string, OffloadBackend>> {
  const routes: Record<string, OffloadBackend> = {};
  for (const prefix of OFFLOAD_ROUTE_PREFIXES) {
    const dir = join(offloadDir, prefix.slice(1, -1));
    await agentFs().mkdir(dir, { recursive: true });
    routes[prefix] = new OffloadBackend(prefix, dir);
  }
  return routes;
}
