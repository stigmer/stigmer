// Minimal PATH lookup, the Node analogue of Go's exec.LookPath.
//
// Scans the PATH entries for an executable file. POSIX-focused (the local stack
// targets macOS and Linux); on those platforms a name with no separator is
// resolved against PATH, and an absolute/relative path is checked directly.

import { accessSync, constants } from "node:fs";
import { delimiter, isAbsolute, join, sep } from "node:path";

/** Resolve an executable by name via PATH, or null if not found. */
export function which(name: string): string | null {
  if (name.includes(sep) || isAbsolute(name)) {
    return isExecutable(name) ? name : null;
  }
  const entries = (process.env.PATH ?? "").split(delimiter).filter((e) => e !== "");
  for (const dir of entries) {
    const candidate = join(dir, name);
    if (isExecutable(candidate)) return candidate;
  }
  return null;
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
