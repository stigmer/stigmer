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
 * WHY READ-ONLY
 * -------------
 * Nothing legitimately writes platform content from a turn: inputs are
 * presented as read-only and plan mode denies every write. A writable mount
 * would also be dangerous and unreviewed: `CompositeBackend.delete` fans a
 * delete out to every route beneath its target, so a delete of `/` or of
 * `/.stigmer` would empty the platform dir, and a routed write would reach
 * the platform dir without passing the CAS observer that file review reads.
 * Every mutation through the mount therefore fails, which also makes the
 * composite refuse any fan-out that touches it.
 *
 * WHEN IT IS MOUNTED
 * ------------------
 * On every turn: `.stigmer/` is the platform's name whether or not the turn
 * mounted anything, so a write there never reaches the workspace. Before
 * #1123 the route existed only on linked turns, and a write under `.stigmer/`
 * on any other turn made a real directory in the user's tree that the next
 * link displaced. What the route exposes follows the link, so the file tools
 * reach exactly what the shell reaches on the same turn:
 * - on a turn whose skill or attachment phase made the link, the platform dir
 *   ({@link PlatformContentBackend});
 * - on any other turn, nothing ({@link NoPlatformContentBackend}): the dir
 *   still holds earlier turns' skills and inputs, which this turn's shell
 *   cannot reach, so the file tools must not either. The root listing then
 *   leaves `.stigmer/` out, as the tree does.
 * The link itself stays: shell commands (a skill's own scripts among them)
 * run in the workspace and resolve `.stigmer/…` through it.
 */

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
import { STIGMER_LOCAL_STATE_DIR, stigmerSymlinkPointsAt } from "../../shared/workspace/stigmer-link.js";

/** The route prefix, with the trailing slash `CompositeBackend` needs to match `/.stigmer/x` but never `/.stigmerx`. */
export const PLATFORM_ROUTE_PREFIX = `/${STIGMER_LOCAL_STATE_DIR}/`;

/** The path as the agent named it: the route hands its backend the path with the prefix stripped. */
function agentPath(routedPath: string): string {
  return `${PLATFORM_ROUTE_PREFIX.slice(0, -1)}${routedPath}`;
}

function readOnly(routedPath: string): string {
  return (
    `Error: '${agentPath(routedPath)}' is platform content (skills, attached inputs, the approved plan) ` +
    "and is read-only; write your own files in the workspace"
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
 * backend for this turn.
 *
 * One behaviour differs from the stock router: listing `/`. The composite
 * adds each route to the root listing whatever the route holds. With the
 * platform exposed, the workspace backend also lists `.stigmer/` by following
 * the link, so the stock listing names the same directory twice and is
 * de-duplicated by path. With nothing exposed, `.stigmer/` is left out of the
 * root listing altogether: the route has nothing to show, and a real
 * `.stigmer` the workspace may hold is unreachable behind it.
 */
export class PlatformRoutedBackend extends CompositeBackend {
  private readonly exposesPlatform: boolean;

  constructor(backend: AnyBackendProtocol, platform: PlatformContentBackend | NoPlatformContentBackend) {
    super(backend, { [PLATFORM_ROUTE_PREFIX]: platform });
    this.exposesPlatform = platform instanceof PlatformContentBackend;
  }

  override async ls(path: string): Promise<LsResult> {
    const result = await super.ls(path);
    if (path !== "/" || !result.files) return result;
    if (!this.exposesPlatform) {
      return { ...result, files: result.files.filter((entry) => entry.path !== PLATFORM_ROUTE_PREFIX) };
    }
    const seen = new Set<string>();
    return {
      ...result,
      files: result.files.filter((entry) => {
        if (seen.has(entry.path)) return false;
        seen.add(entry.path);
        return true;
      }),
    };
  }
}

export interface PlatformRouteOptions {
  /** The workspace root the backend is rooted at (where the link lives). */
  readonly workspaceDir: string;
  /** The session's platform dir; absent when the session has none. */
  readonly platformDir: string | undefined;
}

/**
 * Mount the `.stigmer/` route over `backend` for this turn: the platform dir
 * when the workspace link points at it, the empty route otherwise. Only a
 * session without a platform dir gets `backend` back unchanged. `execute`
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
  const platform = (await stigmerSymlinkPointsAt(workspaceDir, platformDir))
    ? new PlatformContentBackend(platformDir)
    : new NoPlatformContentBackend();
  return new PlatformRoutedBackend(backend, platform);
}
