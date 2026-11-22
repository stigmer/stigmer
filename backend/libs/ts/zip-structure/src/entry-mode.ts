/**
 * Whether an archive entry is a script a command may run directly: the one
 * rule every reader of a pushed archive applies to the executable bit.
 *
 * A ZIP's mode bits are not trusted (most writers leave them unset, and a
 * pushed archive's entries are judged by name and bytes alone), so the bit
 * is inferred: a script extension, or a file that opens with `#!`. Claude
 * Code plugins run extensionless scripts directly (`hooks/check`,
 * `bin/tool`), so the shebang is the signal that matters for them; skills
 * gain it too.
 *
 * Shared because two processes must agree on it byte for byte: the
 * runner, which writes a skill's or plugin's tree with these modes
 * (`runner` `shared/archive-mount.ts`), and the server, whose table of an
 * archive's files tells a reader which files are executable
 * (`stigmer-server` `archive/file-index.ts`). A file listed one way and
 * written another would change what a command can run.
 *
 * The one piece of policy in this otherwise structural library, kept here
 * because both consumers already depend on it and nothing else does.
 */

import { extname } from "node:path/posix";

/** Extensions read as executable whatever their first bytes say. */
const SCRIPT_EXTENSIONS: ReadonlySet<string> = new Set([".sh", ".py", ".js", ".ts", ".rb", ".pl"]);

/** `#!`, the two bytes that make a file runnable as `./file`. */
const SHEBANG = [0x23, 0x21] as const;

/** Whether the entry at `path` with these bytes is executable. */
export function isExecutableEntry(path: string, content: Uint8Array): boolean {
  const shebang = content.length >= 2 && content[0] === SHEBANG[0] && content[1] === SHEBANG[1];
  return shebang || SCRIPT_EXTENSIONS.has(extname(path));
}

/** The mode an entry is written with: 0755 for an executable entry, 0644 otherwise. */
export function entryFileMode(path: string, content: Uint8Array): number {
  return isExecutableEntry(path, content) ? 0o755 : 0o644;
}
