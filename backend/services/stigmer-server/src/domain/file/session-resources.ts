/**
 * A conversation's resources (SessionSpec.resources), made whole on every
 * session write: the rules the contract cannot state, and the Files named
 * there turned into the conversation's own.
 *
 * The rules:
 *   - a repository's or a folder's name is unique among them (the
 *     workspace directory it is given);
 *   - at most 500 Files (Managed Agents' cap on a session's files), each
 *     named once;
 *   - a File's mount path, under .stigmer/uploads/, is normalized and
 *     placeable: no control characters, no name over the filesystem's 255
 *     bytes, no path over 1024 bytes, and never a file where another File
 *     needs a folder (`data` beside `data/a.csv`). Empty takes the
 *     filename, renamed `stem-2.ext`, `stem-3.ext` on a clash (the rename
 *     the runner and the console made for attachments, so a person sees one
 *     shape) and cut to fit; a path a writer chose that clashes is refused,
 *     since only a derived name may change.
 *
 * Each File named that is not already the conversation's becomes its own
 * copy (instances.ts), and the entry names the copy. An entry the stored
 * row already held is kept as stored, so an update that leaves the Files
 * alone reads none of them.
 *
 * Proven by __tests__/session-resources.test.ts and the session composed
 * suite.
 */
import path from "node:path";

import type { Session } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import type { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import type { FileResource } from "@stigmer/apis/ai/stigmer/agentic/session/v1/resource_pb";

import { invalidArgumentError } from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import type { FileInstances } from "./instances.js";

/** The most Files a conversation holds. */
export const MAX_SESSION_FILES = 500;

/** The most bytes one name in a mount path holds: the filesystem's NAME_MAX. */
export const MAX_MOUNT_NAME_BYTES = 255;

/** The most bytes a whole mount path holds, well inside PATH_MAX with the uploads folder before it. */
export const MAX_MOUNT_PATH_BYTES = 1024;

const byteLength = (text: string): number => Buffer.byteLength(text, "utf8");

/**
 * The mount path already in `taken` that `candidate` cannot stand beside:
 * the same path, a File at a folder `candidate` needs, or a File under
 * `candidate` as a folder. Undefined when it can be placed.
 */
export function mountPathConflict(candidate: string, taken: ReadonlySet<string>): string | undefined {
  if (taken.has(candidate)) {
    return candidate;
  }
  for (const held of taken) {
    if (held.startsWith(`${candidate}/`) || candidate.startsWith(`${held}/`)) {
      return held;
    }
  }
  return undefined;
}

/** `stem` cut, a whole character at a time, until `stem + suffix` fits a name. */
function fitName(stem: string, suffix: string): string {
  const chars = Array.from(stem);
  while (chars.length > 0 && byteLength(chars.join("") + suffix) > MAX_MOUNT_NAME_BYTES) {
    chars.pop();
  }
  return chars.join("");
}

/**
 * `name` when it can be placed beside `taken`, else the first free
 * `stem-2.ext`, `stem-3.ext`, …, the stem cut so each fits a name. A
 * leading dot (".env") is a hidden file's, not an extension's.
 */
export function uniquifyMountPath(name: string, taken: ReadonlySet<string>): string {
  const slash = name.lastIndexOf("/");
  const dir = slash === -1 ? "" : name.slice(0, slash + 1);
  const base = name.slice(slash + 1);
  const dot = base.lastIndexOf(".");
  const rawExt = dot > 0 ? base.slice(dot) : "";
  const ext = byteLength(rawExt) > MAX_MOUNT_NAME_BYTES / 2 ? "" : rawExt;
  const stem = dot > 0 && ext !== "" ? base.slice(0, dot) : base;
  const first = `${dir}${fitName(stem, ext)}${ext}`;
  if (mountPathConflict(first, taken) === undefined) {
    return first;
  }
  // A File at the folder itself, or above it, blocks every rename of the name.
  const folder = dir.slice(0, -1);
  const blocking = [...taken].find((held) => held === folder || folder.startsWith(`${held}/`));
  if (dir !== "" && blocking !== undefined) {
    throw invalidArgumentError(`'${blocking}' is a file, so nothing can be mounted under it`);
  }
  for (let n = 2; ; n++) {
    const suffix = `-${n}${ext}`;
    const candidate = `${dir}${fitName(stem, suffix)}${suffix}`;
    if (mountPathConflict(candidate, taken) === undefined) {
      return candidate;
    }
  }
}

/**
 * A writer's mount path, normalized (no `./`, no doubled or trailing slash)
 * and placeable: under .stigmer/uploads/, no control character, no name
 * over {@link MAX_MOUNT_NAME_BYTES} and no path over
 * {@link MAX_MOUNT_PATH_BYTES}.
 */
export function normalizeMountPath(mountPath: string): string {
  const normalized = path.posix.normalize(mountPath).replace(/^(\.\/)+/, "").replace(/\/+$/, "");
  if (normalized === "" || normalized === "." || normalized.startsWith("../") || normalized === "..") {
    throw invalidArgumentError(`mount_path '${mountPath}' does not name a file under .stigmer/uploads/`);
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(normalized)) {
    throw invalidArgumentError("a mount_path holds no control characters");
  }
  if (byteLength(normalized) > MAX_MOUNT_PATH_BYTES) {
    throw invalidArgumentError(`a mount_path holds at most ${MAX_MOUNT_PATH_BYTES} bytes`);
  }
  if (normalized.split("/").some((name) => byteLength(name) > MAX_MOUNT_NAME_BYTES)) {
    throw invalidArgumentError(`each name in a mount_path holds at most ${MAX_MOUNT_NAME_BYTES} bytes`);
  }
  return normalized;
}

type SessionDesc = typeof SessionSchema;

/** The ids of the Files the stored row held, with their mount paths. */
function storedFileMounts(stored: Session | undefined): Map<string, string> {
  const mounts = new Map<string, string>();
  for (const entry of stored?.spec?.resources ?? []) {
    if (entry.resource.case === "file") {
      mounts.set(entry.resource.value.fileId, entry.resource.value.mountPath);
    }
  }
  return mounts;
}

export function newResolveSessionResourcesStep(instances: FileInstances): PipelineStep<SessionDesc> {
  return {
    name: "ResolveSessionResources",
    async execute(ctx: RequestContext<SessionDesc>): Promise<void> {
      const session = ctx.newState;
      const resources = session.spec?.resources ?? [];
      const names = new Set<string>();
      let files = 0;
      for (const entry of resources) {
        if (entry.resource.case === "file") {
          files++;
          continue;
        }
        if (names.has(entry.name)) {
          throw invalidArgumentError(
            `resource '${entry.name}' appears more than once: give each repository and folder its own name`,
          );
        }
        names.add(entry.name);
      }
      if (files > MAX_SESSION_FILES) {
        throw invalidArgumentError(
          `a conversation holds at most ${MAX_SESSION_FILES} files; this one would hold ${files}`,
        );
      }
      if (files === 0) {
        return;
      }

      const target = { org: session.metadata?.org ?? "", sessionId: session.metadata?.id ?? "" };
      const stored = storedFileMounts(ctx.get(EXISTING_RESOURCE_KEY) as Session | undefined);
      const taken = new Set<string>();
      const named = new Set<string>();
      // A writer's own paths first, so a derived name never takes one.
      const pending: Array<{ readonly resource: FileResource; readonly filename: string }> = [];
      for (const entry of resources) {
        if (entry.resource.case !== "file") {
          continue;
        }
        const resource = entry.resource.value;
        const kept = stored.get(resource.fileId);
        let filename = "";
        if (kept === undefined || (resource.mountPath !== "" && normalizeMountPath(resource.mountPath) !== kept)) {
          const file = await instances.resolve(resource.fileId, target, ctx.callerIdentity);
          resource.fileId = file.metadata?.id ?? "";
          filename = file.spec?.filename ?? "";
        } else {
          resource.mountPath = kept;
        }
        if (named.has(resource.fileId)) {
          throw invalidArgumentError(`file ${resource.fileId} is named more than once in this conversation`);
        }
        named.add(resource.fileId);
        if (resource.mountPath === "") {
          pending.push({ resource, filename });
          continue;
        }
        const mountPath = normalizeMountPath(resource.mountPath);
        const conflict = mountPathConflict(mountPath, taken);
        if (conflict === mountPath) {
          throw invalidArgumentError(`two files are mounted at '${mountPath}': give each its own mount_path`);
        }
        if (conflict !== undefined) {
          throw invalidArgumentError(
            `'${mountPath}' and '${conflict}' cannot both be mounted: one is a file where the other needs a folder`,
          );
        }
        taken.add(mountPath);
        resource.mountPath = mountPath;
      }
      for (const { resource, filename } of pending) {
        const mountPath = uniquifyMountPath(filename, taken);
        taken.add(mountPath);
        resource.mountPath = mountPath;
      }
    },
  };
}
