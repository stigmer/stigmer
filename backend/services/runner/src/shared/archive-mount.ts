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
 * - {@link downloadArchive}: mint a download URL and fetch over HTTP, so
 *   the archive's full size is deliverable. A transport that names an
 *   inline read takes it, capped by the gRPC message limit, on the mint
 *   answers it names (an Eval's: `FailedPrecondition`, a server running
 *   without a transfer lane); every other refusal fails the download.
 * - {@link resetDirectory} then {@link writeArchiveEntries}: a mount is
 *   rebuilt from scratch, so a file the new content no longer carries never
 *   lingers, and every entry must resolve inside the mount.
 * - {@link archiveFileMode}: the ZIP layer is mode-blind (path and bytes
 *   only, `zip-extract.ts`), so the executable bit is inferred, by the one
 *   rule the server's file table shares (`@stigmer/zip-structure`
 *   `entry-mode.ts`).
 *
 * Extracted from `skill-mount.ts` when the plugin mount arrived, so the two
 * mounts cannot drift.
 */

import { agentFs } from "./agent-fs.js";
import { dirname, resolve } from "node:path";
import { entryFileMode } from "@stigmer/zip-structure";
import { ConnectError, type Code } from "@connectrpc/connect";
import type { ZipFileEntry } from "./zip-extract.js";

/** How a server hands out an archive's bytes, by storage key. */
export interface ArchiveTransport {
  /** Mint an HTTP download URL. */
  readonly mintDownloadUrl: (artifactStorageKey: string) => Promise<{ readonly url: string; readonly sizeBytes: bigint }>;
  /**
   * The inline read, capped by the server's gRPC message limit, and the
   * answers to the mint that send the download there; absent, every
   * refusal of the mint fails the download.
   */
  readonly inline?: {
    readonly on: readonly Code[];
    readonly fetch: (artifactStorageKey: string) => Promise<{ readonly artifact: Uint8Array }>;
  };
}

/**
 * Download an archive's bytes over the transfer lane (#675), or inline where
 * the transport says so. `undefined` when the server holds no bytes for the
 * key.
 */
export async function downloadArchive(
  transport: ArchiveTransport,
  artifactStorageKey: string,
): Promise<Uint8Array | undefined> {
  let minted;
  try {
    minted = await transport.mintDownloadUrl(artifactStorageKey);
  } catch (err) {
    if (transport.inline !== undefined && err instanceof ConnectError && transport.inline.on.includes(err.code)) {
      const resp = await transport.inline.fetch(artifactStorageKey);
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

/**
 * The mode an archive entry is written with: 0755 for a script, 0644
 * otherwise, by the rule the server's file table also reads
 * (`@stigmer/zip-structure` `entryFileMode`).
 */
export function archiveFileMode(path: string, content: Uint8Array): number {
  return entryFileMode(path, content);
}

/** Remove a mount directory and create it empty. */
export async function resetDirectory(dir: string): Promise<void> {
  await agentFs().rm(dir, { recursive: true, force: true });
  await agentFs().mkdir(dir, { recursive: true });
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
    await agentFs().mkdir(dirname(filePath), { recursive: true });
    await agentFs().writeFile(filePath, entry.content, { mode: archiveFileMode(entry.path, entry.content) });
  }
}
