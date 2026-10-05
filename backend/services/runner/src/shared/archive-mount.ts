/**
 * Archive mount mechanics — the one copy of how a pushed archive (a skill's,
 * a plugin's) travels to the runner and lands as a directory tree.
 *
 * Both archives share one blob driver and one download lane on the server,
 * so the runner's half is shared too: a skill mount (`skill-mount.ts`) and a
 * plugin mount (`plugin-mount.ts`) each keep only what is their own (the
 * skill's `SKILL.md` and hash marker; the plugin's content-addressed cache
 * and its tamper guard) and call these for the rest:
 *
 * - {@link downloadArchive}: mint a download URL first and fetch over HTTP,
 *   so the archive's full size is deliverable; fall back to the unary RPC,
 *   capped by the gRPC message limit, only when the server predates the
 *   lane (`Unimplemented`).
 * - {@link resetDirectory} then {@link writeArchiveEntries}: a mount is
 *   rebuilt from scratch, so a file the new content no longer carries never
 *   lingers, and every entry must resolve inside the mount.
 * - {@link archiveFileMode}: the ZIP layer is mode-blind (path and bytes
 *   only, `zip-extract.ts`), so the executable bit is inferred: a script
 *   extension, or a file that opens with `#!`. Claude Code plugins run
 *   extensionless scripts directly (`hooks/check`, `bin/tool`), so the
 *   shebang is the signal that matters for them; skills gain it too.
 *
 * Extracted from `skill-mount.ts` when the plugin mount arrived, so the two
 * mounts cannot drift.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { ConnectError, Code } from "@connectrpc/connect";
import type { ZipFileEntry } from "./zip-extract.js";

/** The two ways a server hands out an archive's bytes, by storage key. */
export interface ArchiveTransport {
  /** Mint an HTTP download URL; throws `Unimplemented` on a server that predates the lane. */
  readonly mintDownloadUrl: (artifactStorageKey: string) => Promise<{ readonly url: string; readonly sizeBytes: bigint }>;
  /** The unary fallback, capped by the server's gRPC message limit. */
  readonly fetchUnary: (artifactStorageKey: string) => Promise<{ readonly artifact: Uint8Array }>;
}

/**
 * Download an archive's bytes, transfer lane first (#675). `undefined` when
 * the server holds no bytes for the key.
 */
export async function downloadArchive(
  transport: ArchiveTransport,
  artifactStorageKey: string,
): Promise<Uint8Array | undefined> {
  let minted;
  try {
    minted = await transport.mintDownloadUrl(artifactStorageKey);
  } catch (err) {
    if (err instanceof ConnectError && err.code === Code.Unimplemented) {
      const resp = await transport.fetchUnary(artifactStorageKey);
      return resp.artifact && resp.artifact.length > 0 ? resp.artifact : undefined;
    }
    throw err;
  }

  const resp = await fetch(minted.url);
  if (!resp.ok) {
    throw new Error(`artifact fetch failed: HTTP ${resp.status} from ${withoutQuery(minted.url)}`);
  }
  const bytes = new Uint8Array(await resp.arrayBuffer());
  if (minted.sizeBytes > 0n && BigInt(bytes.length) !== minted.sizeBytes) {
    throw new Error(
      `artifact fetch truncated: got ${bytes.length} bytes, expected ${minted.sizeBytes}`,
    );
  }
  return bytes.length > 0 ? bytes : undefined;
}

/**
 * A download URL without its query: a minted URL is a capability, signed in
 * its query string, and an error that carries it may reach a run's status.
 */
function withoutQuery(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "the minted download URL";
  }
}

/** Extensions written executable whatever their first bytes say. */
const SCRIPT_EXTENSIONS = new Set([".sh", ".py", ".js", ".ts", ".rb", ".pl"]);

/** `#!`, the two bytes that make a file runnable as `./file`. */
const SHEBANG = [0x23, 0x21] as const;

/** The mode an archive entry is written with: 0755 for a script, 0644 otherwise. */
export function archiveFileMode(path: string, content: Uint8Array): number {
  const shebang = content.length >= 2 && content[0] === SHEBANG[0] && content[1] === SHEBANG[1];
  return shebang || SCRIPT_EXTENSIONS.has(extname(path)) ? 0o755 : 0o644;
}

/** Remove a mount directory and create it empty. */
export async function resetDirectory(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
}

/**
 * The absolute path an entry lands at inside `dir`, or a thrown error when
 * it would escape. The server refuses traversal at push; this is the
 * runner's own defence in depth.
 */
export function entryPathIn(dir: string, entryPath: string, label: string): string {
  const root = resolve(dir);
  const filePath = resolve(root, entryPath);
  if (filePath !== root && !filePath.startsWith(root + "/")) {
    throw new Error(`${label} entry escapes its mount directory: '${entryPath}'`);
  }
  return filePath;
}

/**
 * Write every entry under `dir`, each with {@link archiveFileMode}. `label`
 * names the archive in a refusal ("skill artifact", "plugin archive").
 */
export async function writeArchiveEntries(
  dir: string,
  entries: readonly ZipFileEntry[],
  label: string,
): Promise<void> {
  for (const entry of entries) {
    const filePath = entryPathIn(dir, entry.path, label);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, entry.content, { mode: archiveFileMode(entry.path, entry.content) });
  }
}
