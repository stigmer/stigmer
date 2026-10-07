#!/usr/bin/env node
/**
 * Carries a rename of the protobuf contract through the repository.
 *
 * The contract is renamed by hand in `apis/ai/stigmer`; everything that
 * follows it is derived, so a reviewer can re-run each step on the base and
 * get the same diff, and a branch in flight can replay it after merging:
 *
 *   image    --ref <git ref> --out <file.json>
 *            the buf image of `apis/` at a ref (read with `git archive`, never
 *            checked out), or of the tree when --ref is omitted.
 *   table    --base <image.json> --head <image.json> [--hand <hand.json>] --out <table.json>
 *            pairs the two images element by element and writes the rename
 *            table (scripts/lib/contract-rename-table.mjs). --hand adds the
 *            names generators do not derive: `{ "ts": {old: new}, "go": {} }`.
 *   ts       --table <table.json> --project <tsconfig> [--project …]
 *            [--move <old dir>=<new dir>] [--exclude <path part>]
 *            rewrites only what tsc flags, round after round
 *            (scripts/lib/contract-rename-ts.mjs).
 *   rename   --project <tsconfig> --names <hand.json> [--exclude <path part>]
 *            renames hand-written names that mirror the contract (`ts` map of
 *            the hand list) through the language service, references and
 *            implementations included; run it before `ts`.
 *   go       --table <table.json> --dir <module dir> [--cmd "go vet ./..."]
 *            the same for Go (scripts/lib/contract-rename-go.mjs).
 *   residue  (--table <table.json> | --pattern <regex>) [--allow <file>] [--path <pathspec> …]
 *            every tracked line still quoting an old name, minus the allow
 *            list (scripts/lib/contract-rename-grep.mjs); exit 1 when any is left.
 *   census   --base <ref> --patterns <file>
 *            per-file counts of each engine literal (one regex per line) at
 *            the base and in the tree; exit 1 on any difference.
 *
 * A rename's own table, hand list and allow list stay out of the tree: they
 * describe one change and go in its pull request.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { runGoRound } from "./lib/contract-rename-go.mjs";
import {
  classifyResidue,
  compareCensus,
  countByFile,
  gitGrep,
  gitRenames,
  parseAllowList,
} from "./lib/contract-rename-grep.mjs";
import { computeRenameTable, RenameTableError, withHandNames } from "./lib/contract-rename-table.mjs";
import { runRenamePass, runTypeScriptPass } from "./lib/contract-rename-ts.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** `--flag value` pairs; a repeated flag collects into a list. */
export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith("--")) throw new Error(`unexpected argument ${a}`);
    const value = rest[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${a} needs a value`);
    const key = a.slice(2);
    flags[key] = key in flags ? [].concat(flags[key], value) : value;
    i++;
  }
  return { command, flags };
}

const list = (v) => (v === undefined ? [] : [].concat(v));
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

/** The escaped alternation of a table's old names, longest first, for the residue. */
export function residuePattern(table) {
  const names = new Set([
    ...Object.keys(table.packages),
    ...Object.keys(table.typeNames),
    ...Object.entries(table.typeNames)
      .filter(([from, to]) => from.split(".").at(-1) !== to.split(".").at(-1))
      .map(([from]) => from.split(".").at(-1)),
    ...Object.keys(table.json),
    ...Object.keys(table.rpc),
    ...Object.keys(table.ts.identifiers),
    ...Object.keys(table.directories),
  ]);
  const escaped = [...names].sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"));
  return `(?<![A-Za-z0-9_])(?:${escaped.join("|")})(?![A-Za-z0-9_])`;
}

function image({ ref, out }) {
  if (!out) throw new Error("image needs --out");
  if (!ref) {
    execFileSync("buf", ["build", "--exclude-source-info", "-o", resolve(out)], {
      cwd: join(ROOT, "apis"),
      stdio: "inherit",
    });
    return 0;
  }
  const dir = mkdtempSync(join(tmpdir(), "contract-rename-"));
  try {
    const tar = execFileSync("git", ["archive", ref, "apis"], { cwd: ROOT, maxBuffer: 1024 * 1024 * 1024 });
    execFileSync("tar", ["-x", "-C", dir], { input: tar });
    execFileSync("buf", ["build", "--exclude-source-info", "-o", resolve(out)], {
      cwd: join(dir, "apis"),
      stdio: "inherit",
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return 0;
}

function table({ base, head, hand, out }) {
  if (!base || !head || !out) throw new Error("table needs --base, --head and --out");
  let t = computeRenameTable(readJson(base), readJson(head));
  if (hand) t = withHandNames(t, readJson(hand));
  writeFileSync(out, `${JSON.stringify(t, null, 2)}\n`);
  console.log(
    `${t.renamed.length} renamed, ${t.added.length} added; ${Object.keys(t.ts.identifiers).length} TypeScript and ${Object.keys(t.go.identifiers).length} Go identifiers`,
  );
  return 0;
}

function typescript(flags) {
  if (!flags.table || !flags.project) throw new Error("ts needs --table and --project");
  const t = readJson(flags.table);
  const moves = Object.fromEntries(list(flags.move).map((m) => m.split("=")));
  let left = 0;
  for (const project of list(flags.project)) {
    console.log(`# ${project}`);
    const result = runTypeScriptPass({
      tsconfig: project,
      table: t,
      moves,
      exclude: list(flags.exclude),
      rootDir: process.cwd(),
      log: (l) => console.log(l),
    });
    console.log(
      `${result.edited.length} files edited in ${result.rounds} rounds; ${result.remaining.length} diagnostics left`,
    );
    for (const r of result.remaining) console.log(`  ${r}`);
    left += result.remaining.length;
  }
  return left === 0 ? 0 : 1;
}

function rename(flags) {
  if (!flags.project || !flags.names) throw new Error("rename needs --project and --names");
  const names = readJson(flags.names).ts ?? {};
  for (const project of list(flags.project)) {
    const result = runRenamePass({ tsconfig: project, names, exclude: list(flags.exclude), rootDir: process.cwd() });
    console.log(`# ${project}: ${result.edited.length} files edited`);
    for (const [from, n] of Object.entries(result.renamed)) console.log(`  ${from} -> ${names[from]}: ${n} locations`);
  }
  return 0;
}

function go(flags) {
  if (!flags.table || !flags.dir) throw new Error("go needs --table and --dir");
  const t = readJson(flags.table);
  const cmd = (flags.cmd ?? "go vet ./...").split(" ");
  for (let round = 1; round <= 20; round++) {
    const run = spawnSync(cmd[0], cmd.slice(1), { cwd: flags.dir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const output = `${run.stdout}\n${run.stderr}`;
    const { count, left } = runGoRound({ output, moduleDir: flags.dir, table: t });
    console.log(`round ${round}: ${count} rewrites`);
    if (count === 0) {
      for (const l of left) console.log(`  ${l.file}:${l.line}:${l.col} ${l.name ?? l.importPath}`);
      if (run.status !== 0) console.log(output.trim());
      return run.status === 0 ? 0 : 1;
    }
  }
  return 1;
}

function residue(flags) {
  const pattern = flags.pattern ?? (flags.table ? residuePattern(readJson(flags.table)) : undefined);
  if (!pattern) throw new Error("residue needs --table or --pattern");
  const hits = gitGrep({ cwd: process.cwd(), pattern, pathspecs: list(flags.path) });
  const rules = flags.allow ? parseAllowList(readFileSync(flags.allow, "utf8")) : [];
  const { kept, residue: left, unused } = classifyResidue(hits, rules);
  for (const h of left) console.log(`${h.file}:${h.line}: ${h.text.trim()}`);
  for (const u of unused) console.log(`allow rule matched nothing: ${u}`);
  console.log(`${left.length} residue lines in ${countByFile(left).size} files; ${kept.length} kept by the allow list`);
  return left.length === 0 ? 0 : 1;
}

function census(flags) {
  if (!flags.base || !flags.patterns) throw new Error("census needs --base and --patterns");
  const patterns = readFileSync(flags.patterns, "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#"));
  const renames = gitRenames({ cwd: process.cwd(), ref: flags.base });
  let differences = 0;
  for (const pattern of patterns) {
    const base = countByFile(gitGrep({ cwd: process.cwd(), pattern, ref: flags.base }));
    const head = countByFile(gitGrep({ cwd: process.cwd(), pattern }));
    const diff = compareCensus(base, head, renames);
    const total = [...head.values()].reduce((a, b) => a + b, 0);
    console.log(`${diff.length === 0 ? "same" : "DIFFERS"}  ${total}  ${pattern}`);
    for (const d of diff) console.log(`    ${d.file}: ${d.before} -> ${d.after}`);
    differences += diff.length;
  }
  return differences === 0 ? 0 : 1;
}

export function main(argv) {
  const { command, flags } = parseArgs(argv);
  switch (command) {
    case "image":
      return image(flags);
    case "table":
      return table(flags);
    case "ts":
      return typescript(flags);
    case "rename":
      return rename(flags);
    case "go":
      return go(flags);
    case "residue":
      return residue(flags);
    case "census":
      return census(flags);
    default:
      throw new Error(`unknown command ${command ?? "(none)"}; one of image, table, ts, rename, go, residue, census`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof RenameTableError ? err.message : (err.stack ?? String(err)));
    process.exitCode = 2;
  }
}
