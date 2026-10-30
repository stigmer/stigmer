/**
 * The conversation core's line: every module under src imports only its own
 * files and the packages this package names (react, @stigmer/client,
 * @stigmer/apis, @bufbuild/protobuf, diff), so a terminal or native host that
 * installs it gets no rendering package, and no file reaches back into the
 * React kit. Read from the sources, type-only imports included: a type from a
 * component file would make the published declarations need the kit.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The packages a core module may name: its dependencies and peers, and its
 * own entries (a doc comment's example imports `@stigmer/react-core/test`).
 */
const ALLOWED = ["react", "@stigmer/client", "@stigmer/apis", "@bufbuild/protobuf", "diff", "@stigmer/react-core"];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** Every module specifier a file names: static imports and re-exports, `import()`. */
function specifiers(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)["']([^"']+)["']/gm)) {
    found.push(match[1]!);
  }
  return found;
}

const packageOf = (specifier: string) =>
  specifier.split("/").slice(0, specifier.startsWith("@") ? 2 : 1).join("/");

describe("the conversation core's imports", () => {
  const files = sourceFiles(SRC);

  it("reads the sources it guards", () => {
    expect(files.length).toBeGreaterThan(50);
    expect(specifiers('import { a } from "x";\nexport { b } from "./y.js";\nconst c = import("z");')).toEqual(["x", "./y.js", "z"]);
  });

  it("names no package outside its dependencies and peers", () => {
    const strays = files.flatMap((file) =>
      specifiers(readFileSync(file, "utf8"))
        .filter((specifier) => !specifier.startsWith(".") && !ALLOWED.includes(packageOf(specifier)))
        .map((specifier) => `${relative(SRC, file)}: ${specifier}`),
    );
    expect(strays).toEqual([]);
  });

  it("never reaches outside its own sources", () => {
    const escapes = files.flatMap((file) =>
      specifiers(readFileSync(file, "utf8"))
        .filter((specifier) => specifier.startsWith(".") && relative(SRC, resolve(dirname(file), specifier)).startsWith(".."))
        .map((specifier) => `${relative(SRC, file)}: ${specifier}`),
    );
    expect(escapes).toEqual([]);
  });
});
