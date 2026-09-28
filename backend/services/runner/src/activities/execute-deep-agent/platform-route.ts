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
 * On the turns where the workspace link points at the platform dir — the
 * turns whose skill or attachment phase made it — so what the agent can
 * reach is exactly what the link exposes to the shell on the same turn.
 * The link itself stays: shell commands (a skill's own scripts among them)
 * run in the workspace and resolve `.stigmer/…` through it.
 */

import { CompositeBackend, FilesystemBackend } from "deepagents";
import type {
  AnyBackendProtocol,
  DeleteResult,
  EditResult,
  FileUploadResponse,
  LsResult,
  WriteResult,
} from "deepagents";
import { STIGMER_LOCAL_STATE_DIR, stigmerSymlinkPointsAt } from "../../shared/workspace/stigmer-link.js";

/** The route prefix, with the trailing slash `CompositeBackend` needs to match `/.stigmer/x` but never `/.stigmerx`. */
export const PLATFORM_ROUTE_PREFIX = `/${STIGMER_LOCAL_STATE_DIR}/`;

function readOnly(routedPath: string): string {
  const agentPath = `${PLATFORM_ROUTE_PREFIX.slice(0, -1)}${routedPath}`;
  return (
    `Error: '${agentPath}' is platform content (skills, attached inputs, the approved plan) ` +
    "and is read-only; write your own files in the workspace"
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
 * The workspace backend with the platform mounted at {@link PLATFORM_ROUTE_PREFIX}.
 *
 * One behaviour differs from the stock router: listing `/`. The composite
 * adds each route to the root listing, and the workspace backend already
 * lists `.stigmer/` by following the link, so the stock listing names the
 * same directory twice; the root listing is de-duplicated by path.
 */
export class PlatformRoutedBackend extends CompositeBackend {
  override async ls(path: string): Promise<LsResult> {
    const result = await super.ls(path);
    if (path !== "/" || !result.files) return result;
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
 * Mount the platform route over `backend` when this turn exposes platform
 * content; otherwise hand `backend` back unchanged. `execute` and the
 * sandbox identity stay the workspace backend's (`CompositeBackend` delegates
 * both to its default), so a shell-capable graph keeps its `execute` tool and
 * a plan-mode graph stays without one.
 */
export async function mountPlatformRoute(
  backend: AnyBackendProtocol,
  options: PlatformRouteOptions,
): Promise<AnyBackendProtocol> {
  const { workspaceDir, platformDir } = options;
  if (platformDir === undefined || !(await stigmerSymlinkPointsAt(workspaceDir, platformDir))) {
    return backend;
  }
  return new PlatformRoutedBackend(backend, {
    [PLATFORM_ROUTE_PREFIX]: new PlatformContentBackend(platformDir),
  });
}
