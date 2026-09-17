#!/usr/bin/env node

/**
 * Cursor `postToolUse` hook: package guidance for a git worktree that is not
 * a workspace folder.
 *
 * Why it exists. The nested `<package>/AGENTS.md` guides reach a chat through
 * generated shims (`.cursor/rules/agents-*.mdc`) and the doctrine skills
 * through their `paths:` frontmatter, and both fire only for files inside a
 * workspace folder. Code changes happen in git worktrees, and a worktree is
 * never a workspace folder: measured on Cursor 3.20.21 (2026-09-17), changing
 * the window's folder set disconnects the tool layer of every other chat in
 * the window until a reload, and a folder that is listed but gone from disk
 * breaks Grep and Glob for all of them. So a worktree path outside the window
 * gets the root guide (the primary checkout is in the window and its copy is
 * identical) and nothing else. This hook supplies the rest: on the first
 * touch of a file under a package in such a worktree, it returns the
 * package's guide chain and names the skills scoped to that path, once per
 * conversation, as `additional_context` after the tool result.
 *
 * What it does, in order, and stops at the first "not ours":
 *
 *   - Takes `tool_input.file_path` from the payload; the tools whose input is
 *     a file (`Read`, `Write`, `Delete`) are the ones the generated matcher
 *     in `.cursor/hooks.json` admits.
 *   - Does nothing for a path inside any `workspace_roots` entry: the shims
 *     and `paths:` own those, and nothing is attached twice.
 *   - Resolves the path's checkout from the nearest `.git`. A directory is a
 *     primary checkout, not a worktree, and not this hook's business. A file
 *     is a worktree link (`gitdir: <primary>/.git/worktrees/<name>`) and names
 *     its primary; the hook acts only when that primary is this repository,
 *     which it knows from its own location (`import.meta.url`, as the gate
 *     does), never from `cwd` or `CURSOR_PROJECT_DIR`: measured on 3.20.21,
 *     the second folder's hook starts in its own folder but sees the first
 *     folder's path in that variable. This is the per-folder scoping the
 *     shims have, moved into the hook.
 *   - Collects every `AGENTS.md` between the file and the worktree root,
 *     nearest last, skipping the root guide (already loaded) and any directory
 *     the gate would never treat as a guide's (`isSkippedDirName`); matches
 *     the `paths:` of every skill against the repo-relative path with the
 *     gate's `matchesGlob`, so one parser and one glob dialect serve both.
 *   - Remembers what a conversation has received under the OS temp directory,
 *     keyed by `conversation_id`, and sweeps entries older than a day.
 *
 * Footprint: reads inside this repository's checkouts, writes only under the
 * temp directory, opens no network connection, prints one JSON object to
 * stdout and nothing else, and never fails closed: any error, malformed input
 * or missing field yields `{}` with exit 0, because a hook that slows a tool
 * call by one Node start is acceptable and one that breaks it is not. It runs
 * under whatever `node` Cursor's environment resolves, not the repository's
 * pinned version, so it uses nothing newer than Node 18. It never echoes
 * `tool_input`, which for `Write` carries the whole new file.
 *
 * Known limits, stated rather than engineered around: a subagent's tool calls
 * fire no hooks (measured), so a subagent editing under a worktree gets no
 * guide while its parent does; a branch that edits a guide still runs under
 * the primary's copy of the root guide; a compacted conversation may lose an
 * injected guide, as it may lose a shim.
 *
 * Usage:
 *   node scripts/agents-context-hook.mjs                     stdin: the postToolUse payload; stdout: the response
 *   node scripts/agents-context-hook.mjs --explain <path> [--conversation <id>]
 *                                                            print how a path resolves: which checkout, which
 *                                                            guides and skills, what the conversation already has
 *
 * Registered by `make agents-sync` (scripts/agents-check.mjs renders
 * `.cursor/hooks.json`). Tests: scripts/agents-context-hook.test.mjs.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { discoverSkills, isSkippedDirName, matchesGlob, parseFrontmatter, splitFrontmatter } from "./agents-check.mjs";

const HOOK_REL = "scripts/agents-context-hook.mjs";
const STATE_DIR_NAME = "agents-context-hook";
const STATE_TTL_MS = 24 * 60 * 60 * 1000;
const WORKTREES_DIR_RE = /^(.*)\/\.git\/worktrees\/[^/]+$/;

function toPosix(p) {
  return p.split(sep).join(posix.sep);
}

/**
 * Canonical absolute form of a path that may not exist (a deleted file, a
 * file about to be written): the real path of the nearest existing ancestor
 * plus the rest. Cursor reports `/tmp/...` where the filesystem says
 * `/private/tmp/...` (measured on macOS), so two paths are compared only in
 * this form.
 */
export function canonical(p) {
  let dir = resolve(p);
  const rest = [];
  while (!existsSync(dir)) {
    const parent = dirname(dir);
    if (parent === dir) return resolve(p);
    rest.unshift(dir.slice(parent.length + 1));
    dir = parent;
  }
  return join(realpathSync(dir), ...rest);
}

/** Segment-aware containment on canonical paths: `/a/b` holds `/a/b/c` and not `/a/bc`. */
export function isInside(path, root) {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * The checkout a path belongs to, from the nearest `.git` entry walking up.
 * `{ kind: "primary", root }` for a `.git` directory; `{ kind: "worktree",
 * root, primary }` for a `gitdir:` link into some primary's `.git/worktrees/`;
 * `{ kind: "other", root }` for any other link (a submodule); `null` when no
 * `.git` is found. All paths canonical.
 */
export function resolveCheckout(path) {
  let dir = canonical(path);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) dir = dirname(dir);
  for (;;) {
    const dotGit = join(dir, ".git");
    if (existsSync(dotGit)) {
      if (statSync(dotGit).isDirectory()) return { kind: "primary", root: dir };
      const m = readFileSync(dotGit, "utf8").match(/^gitdir:\s*(.+?)\s*$/m);
      if (!m) return { kind: "other", root: dir };
      const gitdir = canonical(resolve(dir, m[1]));
      const wt = toPosix(gitdir).match(WORKTREES_DIR_RE);
      return wt ? { kind: "worktree", root: dir, primary: canonical(wt[1]) } : { kind: "other", root: dir };
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * The nested guides that bind `relPath` inside a checkout, outermost first so
 * the guide nearest the code arrives last and freshest. The root guide is not
 * one of them, and a guide below a directory the gate skips is not a guide.
 */
export function guidesFor(checkoutRoot, relPath) {
  const guides = [];
  const segments = posix
    .dirname(relPath)
    .split("/")
    .filter((s) => s && s !== ".");
  for (let i = 1; i <= segments.length; i++) {
    if (isSkippedDirName(segments[i - 1])) break;
    const dir = segments.slice(0, i).join("/");
    if (existsSync(join(checkoutRoot, dir, "AGENTS.md"))) guides.push(`${dir}/AGENTS.md`);
  }
  return guides;
}

/** The skills whose `paths:` match `relPath`, as repo-relative `SKILL.md` paths; a skill without `paths:` is not scoped and is not offered here. */
export function skillsFor(checkoutRoot, relPath) {
  return discoverSkills(checkoutRoot).filter((skillRel) => {
    const parts = splitFrontmatter(readFileSync(join(checkoutRoot, skillRel), "utf8"));
    if (!parts) return false;
    const paths = parseFrontmatter(parts.frontmatter).paths;
    if (paths === undefined) return false;
    return (Array.isArray(paths) ? paths : [paths]).some((g) => matchesGlob(g, relPath));
  });
}

/** Per-conversation memory of what has been injected, one small JSON file each; entries older than `STATE_TTL_MS` are swept on every visit. */
export function stateFor(stateDir, conversationId, now = Date.now()) {
  mkdirSync(stateDir, { recursive: true });
  for (const name of readdirSync(stateDir)) {
    const abs = join(stateDir, name);
    if (now - statSync(abs).mtimeMs > STATE_TTL_MS) unlinkSync(abs);
  }
  const file = join(stateDir, `${String(conversationId).replace(/[^A-Za-z0-9_-]/g, "_")}.json`);
  const seen = new Set(existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : []);
  return {
    has: (key) => seen.has(key),
    add: (keys) => {
      for (const k of keys) seen.add(k);
      writeFileSync(file, JSON.stringify([...seen]));
    },
  };
}

/**
 * Decide what, if anything, to inject for one payload. Returns a description
 * with a `reason` in every branch, so `--explain` and the tests can see why
 * nothing happened; `context` is the text to inject, or null.
 */
export function planInjection(payload, { projectRoot, stateDir, now = Date.now() }) {
  const filePath = payload && payload.tool_input && payload.tool_input.file_path;
  if (typeof filePath !== "string" || filePath === "") return { context: null, reason: "no tool_input.file_path" };

  const path = canonical(filePath);
  const roots = Array.isArray(payload.workspace_roots) ? payload.workspace_roots.map(canonical) : [];
  if (roots.some((r) => isInside(path, r)))
    return {
      context: null,
      reason: "inside a workspace folder; the shims and skill paths own it",
      path,
    };

  const checkout = resolveCheckout(path);
  if (!checkout) return { context: null, reason: "not inside any git checkout", path };
  if (checkout.kind !== "worktree")
    return {
      context: null,
      reason: `a ${checkout.kind} checkout, not a worktree`,
      path,
      checkout,
    };
  const project = canonical(projectRoot);
  if (checkout.primary !== project)
    return {
      context: null,
      reason: `a worktree of ${checkout.primary}, not of this repository`,
      path,
      checkout,
    };

  const relPath = toPosix(relative(checkout.root, path));
  const guides = guidesFor(checkout.root, relPath);
  const skills = skillsFor(checkout.root, relPath);
  const state =
    typeof payload.conversation_id === "string" && payload.conversation_id !== ""
      ? stateFor(stateDir, payload.conversation_id, now)
      : null;
  const key = (rel) => `${checkout.root}:${rel}`;
  const newGuides = guides.filter((g) => !state || !state.has(key(g)));
  const newSkills = skills.filter((s) => !state || !state.has(key(s)));
  if (newGuides.length === 0 && newSkills.length === 0) {
    return {
      context: null,
      reason:
        guides.length + skills.length === 0
          ? "no package guide or scoped skill binds this path"
          : "already injected in this conversation",
      path,
      checkout,
      relPath,
      guides,
      skills,
    };
  }
  if (state) state.add([...newGuides, ...newSkills].map(key));
  return {
    context: renderContext(checkout.root, newGuides, newSkills),
    reason: "injected",
    path,
    checkout,
    relPath,
    guides,
    skills,
    newGuides,
    newSkills,
  };
}

/** The injected text: one provenance line, each guide under its own heading, then the scoped skills by path (a skill is on demand by design; the model reads it). */
export function renderContext(checkoutRoot, guides, skills) {
  const lines = [
    `Package guidance for the git worktree at ${checkoutRoot}, which is outside the window; attached by ${HOOK_REL} on the first touch of a file under each package.`,
  ];
  for (const g of guides) {
    lines.push("", `--- ${g} ---`, readFileSync(join(checkoutRoot, g), "utf8").trimEnd());
  }
  if (skills.length > 0) {
    lines.push("", `Skills scoped to this path; read before working here: ${skills.join(", ")}`);
  }
  return `${lines.join("\n")}\n`;
}

function explain(argv, { projectRoot, stateDir }) {
  const at = argv.indexOf("--explain");
  const target = argv[at + 1];
  if (!target) return "usage: --explain <path> [--conversation <id>]";
  const convAt = argv.indexOf("--conversation");
  const conversationId = convAt === -1 ? undefined : argv[convAt + 1];
  const out = [`path        ${canonical(target)}`, `project     ${canonical(projectRoot)}`];
  const checkout = resolveCheckout(target);
  out.push(
    `checkout    ${checkout ? `${checkout.kind} at ${checkout.root}${checkout.primary ? ` (primary ${checkout.primary})` : ""}` : "none"}`,
  );
  out.push(
    "workspace   whether the path is inside a workspace folder is known only from the hook payload; a path inside one is never served here",
  );
  if (checkout && checkout.kind === "worktree") {
    const relPath = toPosix(relative(checkout.root, canonical(target)));
    out.push(
      `serves      ${checkout.primary === canonical(projectRoot) ? "yes, a worktree of this repository" : "no, a worktree of another repository"}`,
    );
    out.push(`guides      ${guidesFor(checkout.root, relPath).join(", ") || "(none)"}`);
    out.push(`skills      ${skillsFor(checkout.root, relPath).join(", ") || "(none)"}`);
    if (conversationId) {
      const state = stateFor(stateDir, conversationId);
      const seen = [...guidesFor(checkout.root, relPath), ...skillsFor(checkout.root, relPath)].filter((rel) =>
        state.has(`${checkout.root}:${rel}`),
      );
      out.push(`injected    ${seen.join(", ") || "(nothing yet for this conversation)"}`);
    }
  }
  return out.join("\n");
}

function main(argv) {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const stateDir = join(tmpdir(), STATE_DIR_NAME);
  if (argv.includes("--explain")) {
    console.log(explain(argv, { projectRoot, stateDir }));
    return 0;
  }
  let response = {};
  try {
    const payload = JSON.parse(readFileSync(0, "utf8"));
    const plan = planInjection(payload, { projectRoot, stateDir });
    if (plan.context) response = { additional_context: plan.context };
  } catch {
    // Deliberately silent: the hook must never turn a tool call into a failure.
  }
  process.stdout.write(JSON.stringify(response));
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
