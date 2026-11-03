// Every file descriptor the generated TypeScript stubs (`@stigmer/apis`)
// define, for tests that must see the whole contract rather than one
// resource's closure. The resource api.proto closure (stigmer-registry.ts)
// reaches no command or query proto and none of the option files only they
// import, so a test over services or method options scans the stubs package
// itself: every `*_pb.ts` module, located through the package's own export
// map and imported by its package path, and the files those import.
//
// The scan reads the built stubs, so it sees a proto edit only after the
// stubs are regenerated and built (`make codegen`).
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import type { DescFile } from "@bufbuild/protobuf";

const PACKAGE = "@stigmer/apis";
const ANCHOR = "ai/stigmer/commons/apiresource/field_options_pb";

/** The stubs package's root: the anchor module resolves to `<root>/dist/<ANCHOR>.js`. */
function stubsRoot(): string {
  const resolved = createRequire(import.meta.url).resolve(`${PACKAGE}/${ANCHOR}`);
  const suffix = path.join("dist", `${ANCHOR}.js`);
  if (!resolved.endsWith(suffix)) throw new Error(`${PACKAGE}/${ANCHOR} resolved to ${resolved}, not <root>/${suffix}`);
  return resolved.slice(0, resolved.length - suffix.length);
}

/** Every generated descriptor module's package subpath (`ai/.../api_pb`), build output and dependencies aside. */
function descriptorModules(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (dir === root && (entry.name === "dist" || entry.name === "node_modules")) continue;
        walk(full);
      } else if (entry.name.endsWith("_pb.ts")) {
        out.push(path.relative(root, full).slice(0, -".ts".length).split(path.sep).join("/"));
      }
    }
  };
  walk(root);
  return out.sort();
}

function isDescFile(value: unknown): value is DescFile {
  return typeof value === "object" && value !== null && (value as { kind?: unknown }).kind === "file";
}

/**
 * Every file descriptor the stubs package exports, with the files they import
 * (the well-known types come from @bufbuild/protobuf, not the stubs), by
 * proto file name.
 */
export async function stubFiles(): Promise<Map<string, DescFile>> {
  const files = new Map<string, DescFile>();
  const visit = (file: DescFile): void => {
    if (files.has(file.proto.name)) return;
    files.set(file.proto.name, file);
    for (const dep of file.dependencies) visit(dep);
  };
  for (const subpath of descriptorModules(stubsRoot())) {
    const mod: Record<string, unknown> = await import(`${PACKAGE}/${subpath}`);
    for (const value of Object.values(mod)) {
      if (isDescFile(value)) visit(value);
    }
  }
  return files;
}
