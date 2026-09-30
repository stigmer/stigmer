#!/usr/bin/env node

/**
 * Reads and writes the review verdict a pull request needs before it merges.
 *
 * Every pull request is read, before it merges, by a reviewer that did not
 * write it: a fresh agent given only the pull request and the brief in
 * `.agents/skills/review-pull-request/SKILL.md`. Its verdict is posted on the
 * pull request as a comment, by this script and never by hand:
 *
 *   ## Review
 *   <!-- review-verdict -->
 *
 *   Verdict: approve
 *   Head: <the head commit the reviewer read>
 *   Reviewed: sha256:<digest>
 *   Reviewer: <model>, fresh context, review-pull-request
 *   Findings: none
 *
 * The marker line under the heading is what makes a comment a review, so a
 * person's own "## Review" notes are never read as a verdict.
 *
 * A comment, not a section of the body, because a comment's author never
 * changes: anyone who opens a pull request writes its body, and any later edit
 * by a maintainer would make a contributor's text look like a maintainer's.
 * A review comment counts only when its author has write access to the
 * repository.
 *
 * The digest binds the verdict to what the reviewer read, not to a commit:
 *   - the change: `git patch-id --verbatim` of the diff from the merge base
 *     to the head. It ignores line numbers, so merging `main` into a branch
 *     keeps it as long as the change's own hunks and their context are
 *     untouched; it keeps whitespace, since a whitespace edit can change
 *     meaning (`rm -rf /tmp/x` against `rm -rf / tmp/x`, a YAML key's
 *     nesting). Every option and setting that shapes the diff's text is
 *     pinned, so the digest a workstation posts is the one CI computes;
 *   - the declarations the body carries (`Test-removal:`, `Quarantine:`,
 *     `Skip:`, `RPC-waiver:`), read by the test-integrity tool's own parser, since the
 *     reviewer judges each one.
 * Any edit to the change, or a declaration added, removed or changed in what
 * it names (every field the integrity tool reads from it, for every kind it
 * parses: `Test-removal:`, `Quarantine:`, `Skip:`, `RPC-waiver:`), makes
 * the verdict stale, and the pull request needs a new review. The digest is
 * taken before the review and posted only if it has not moved since, so a
 * declaration added while the reviewer reads is never approved unread.
 *
 * The state of a pull request is its newest review comment by a writer:
 *   current         approve, and its digest is the digest now
 *   stale           its digest is not the digest now (new code, or a new declaration)
 *   changes-needed  the reviewer asked for changes to exactly this change
 *   invalid         the comment does not parse as a review
 *   missing         no review comment by a writer
 *
 * What the check proves is that an account with write access posted a current
 * approve. That the reviewer did not write the change rests on the procedure
 * (a fresh reviewer, launched with a fixed prompt, whose output this script
 * posts); no check can see who wrote the judgment, since every verdict is
 * posted by a maintainer's account.
 *
 * Callers: the `Review verdict` check (.github/workflows/ci.review.yaml), the
 * review and pull-request skills, and any downstream merge guard that imports
 * `readReview` from a byte-identical copy of this file.
 *
 * Usage:
 *   node scripts/review-verdict.mjs --status -R <owner/repo> <n> [--expect-head <sha>] [--dir <checkout>] [--json]
 *   node scripts/review-verdict.mjs --write -R <owner/repo> <n> --verdict-file <json> --reviewed-head <sha> --reviewed-digest <sha256:…> [--dir <checkout>]
 *
 * `--dir` is a checkout of the pull request's repository, where the diff is
 * computed; it defaults to the checkout this script lives in when that is the
 * same repository. `--reviewed-head` and `--reviewed-digest` are the `head`
 * and `digest` that `--status --json` printed before the reviewer was
 * launched. `--verdict-file` holds the reviewer's JSON output:
 *   { "verdict": "approve" | "changes-needed", "reviewer": "<model>",
 *     "findings": [{ "path": "...", "line": 1, "severity": "blocking" | "minor", "summary": "..." }] }
 *
 * Exit: 0 current (for --status) or posted (for --write); 1 not current, or
 * the verdict was refused; 2 the script could not judge (a usage, git or gh
 * error).
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseDeclarations } from "./test-integrity.mjs";

export const HEADING = "## Review";
export const MARKER = "<!-- review-verdict -->";
export const VERDICTS = Object.freeze(["approve", "changes-needed"]);
export const SEVERITIES = Object.freeze(["blocking", "minor"]);
export const WRITE_PERMISSIONS = Object.freeze(["admin", "maintain", "write"]);
export const CHECK_WORKFLOW = "ci.review.yaml";

const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const KEY_LINE = /^([A-Z][A-Za-z-]*):[ \t]*(.*)$/;
const FINDING_LINE = /^-[ \t]+(.+)$/;
const SCRIPT = fileURLToPath(import.meta.url);

// ─── The verdict ────────────────────────────────────────────────────────

/**
 * Parses a comment body as a review. Returns undefined for a comment that is
 * not a review (it does not open with the heading), else the fields and every
 * problem found; a review with problems is invalid, never current.
 */
export function parseReview(body) {
  const lines = (body ?? "").replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;
  if (lines[i]?.trim() !== HEADING) return undefined;
  let j = i + 1;
  while (j < lines.length && lines[j].trim() === "") j++;
  if (lines[j]?.trim() !== MARKER) return undefined;

  const fields = new Map();
  const findings = [];
  const problems = [];
  let inFindings = false;
  for (const raw of lines.slice(j + 1)) {
    const line = raw.trimEnd();
    if (line.trim() === "") continue;
    const key = KEY_LINE.exec(line);
    if (key) {
      if (fields.has(key[1])) problems.push(`${key[1]} appears twice`);
      fields.set(key[1], key[2].trim());
      inFindings = key[1] === "Findings";
      continue;
    }
    const finding = FINDING_LINE.exec(line.trim());
    if (inFindings && finding) findings.push(finding[1]);
    else problems.push(`unexpected line: ${line.trim().slice(0, 80)}`);
  }

  const verdict = fields.get("Verdict");
  const head = fields.get("Head");
  const reviewed = fields.get("Reviewed");
  const reviewer = fields.get("Reviewer");
  const findingsField = fields.get("Findings");
  if (!VERDICTS.includes(verdict)) problems.push(`Verdict must be one of ${VERDICTS.join(", ")}`);
  if (!SHA.test(head ?? "")) problems.push("Head must be a full commit SHA");
  if (!DIGEST.test(reviewed ?? "")) problems.push("Reviewed must be sha256:<64 hex>");
  if (!reviewer) problems.push("Reviewer is missing");
  if (findingsField === undefined) problems.push("Findings is missing");
  else if (findingsField === "none" && findings.length > 0) problems.push("Findings says none and lists findings");
  else if (findingsField !== "none" && findingsField !== "") problems.push("Findings is `none` or a list below it");
  else if (findingsField === "" && findings.length === 0) problems.push("Findings lists nothing; write `none`");

  return { verdict, head, reviewed, reviewer, findings, problems };
}

/** The declarations as one canonical text, so a reworded or added one moves the digest. */
export function declarationText(body) {
  // Every kind the integrity tool parses, with every field it reads, so a kind
  // it gains later is bound here without a change to this file.
  const parsed = parseDeclarations(body ?? "");
  return Object.keys(parsed)
    .sort()
    .flatMap((kind) => parsed[kind].map((declaration) => `${kind} ${JSON.stringify(declaration)}`))
    .join("\n");
}

/** What a verdict is bound to: the change's patch id and the body's declarations. */
export function changeDigest({ changeId, declarations }) {
  if (!changeId) throw new Error("no change id to bind the verdict to");
  const hash = createHash("sha256");
  hash.update(`change ${changeId}\n`);
  hash.update(`declarations\n${declarations ?? ""}\n`);
  return `sha256:${hash.digest("hex")}`;
}

/**
 * The state of a pull request from its comments, oldest first, each
 * `{ author, body, url }`. `trusted(login)` says whether an author may write
 * a review that counts. The newest review comment by a trusted author decides.
 */
export function reviewState({ comments, digest, trusted }) {
  const reviews = [];
  let ignored = 0;
  for (const comment of comments) {
    const review = parseReview(comment.body);
    if (!review) continue;
    if (!trusted(comment.author)) {
      ignored++;
      continue;
    }
    reviews.push({ ...review, author: comment.author, url: comment.url });
  }
  const aside = ignored > 0 ? ` (${ignored} review comment(s) by accounts without write access ignored)` : "";
  const newest = reviews.at(-1);
  if (!newest) return { state: "missing", reason: `no review by an account with write access${aside}` };
  const at = newest.url ? ` (${newest.url})` : "";
  if (newest.problems.length > 0) {
    return { state: "invalid", reason: `the newest review does not parse: ${newest.problems.join("; ")}${at}`, review: newest };
  }
  if (newest.reviewed !== digest) {
    return {
      state: "stale",
      reason: `the newest review (${newest.verdict}, head ${newest.head.slice(0, 10)}) read a different change or different declarations${at}`,
      review: newest,
    };
  }
  if (newest.verdict === "changes-needed") {
    return { state: "changes-needed", reason: `the reviewer asked for changes to this change${at}`, review: newest };
  }
  return { state: "current", reason: `approved by ${newest.reviewer}${at}`, review: newest };
}

/** Checks a reviewer's JSON output; returns the problems, empty when it can be posted. */
export function verdictProblems(output) {
  const problems = [];
  if (!output || typeof output !== "object") return ["the verdict is not a JSON object"];
  if (!VERDICTS.includes(output.verdict)) problems.push(`verdict must be one of ${VERDICTS.join(", ")}`);
  if (typeof output.reviewer !== "string" || output.reviewer.trim() === "") problems.push("reviewer names the model that reviewed");
  if (!Array.isArray(output.findings)) problems.push("findings is a list (empty when there are none)");
  for (const [i, f] of (Array.isArray(output.findings) ? output.findings : []).entries()) {
    if (typeof f?.path !== "string" || f.path === "") problems.push(`findings[${i}].path is missing`);
    if (f?.line !== undefined && !Number.isInteger(f.line)) problems.push(`findings[${i}].line is not a line number`);
    if (!SEVERITIES.includes(f?.severity)) problems.push(`findings[${i}].severity must be one of ${SEVERITIES.join(", ")}`);
    if (typeof f?.summary !== "string" || f.summary.trim() === "") problems.push(`findings[${i}].summary is missing`);
  }
  const blocking = (Array.isArray(output.findings) ? output.findings : []).some((f) => f?.severity === "blocking");
  if (output.verdict === "approve" && blocking) problems.push("an approve cannot carry a blocking finding");
  if (output.verdict === "changes-needed" && !blocking) problems.push("a changes-needed names at least one blocking finding, the change to make");
  return problems;
}

/** The comment for a verdict. Each finding is one line, so the comment always parses. */
export function renderReview({ verdict, head, reviewed, reviewer, findings }) {
  const oneLine = (text) => String(text).replace(/\s+/g, " ").trim();
  const lines = [HEADING, MARKER, "", `Verdict: ${verdict}`, `Head: ${head}`, `Reviewed: ${reviewed}`, `Reviewer: ${oneLine(reviewer)}, fresh context, review-pull-request`];
  if (findings.length === 0) lines.push("Findings: none");
  else {
    lines.push("Findings:");
    for (const f of findings) lines.push(`- ${oneLine(f.path)}${f.line ? `:${f.line}` : ""} (${f.severity}) ${oneLine(f.summary)}`);
  }
  return `${lines.join("\n")}\n`;
}

// ─── The lookups ────────────────────────────────────────────────────────

function run(command, args, { cwd, input } = {}) {
  return execFileSync(command, args, { cwd, input, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] });
}

const gh = (args) => run("gh", args);

/** What a failed command said: the first line of its stderr, else its message. */
export function errorText(error) {
  const stderr = String(error?.stderr ?? "").split("\n").map((line) => line.trim()).find(Boolean);
  return stderr ?? String(error?.message ?? error).split("\n")[0].trim();
}

/** `owner/repo` of a remote URL (https, ssh or scp form), or undefined. */
export function repoFromUrl(url) {
  const match = /[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec((url ?? "").trim());
  return match ? `${match[1]}/${match[2]}` : undefined;
}

/** `owner/repo` of a checkout's origin, or undefined. */
export function originRepo(dir) {
  try {
    return repoFromUrl(run("git", ["remote", "get-url", "origin"], { cwd: dir }));
  } catch {
    return undefined;
  }
}

/** The checkout to compute the diff in: `--dir`, else this script's own when it is the same repository. */
export function checkoutFor(repo, dir) {
  const candidate = resolve(dir ?? dirname(SCRIPT));
  const origin = originRepo(candidate);
  if (origin?.toLowerCase() !== repo.toLowerCase()) {
    throw new Error(`${candidate} is a checkout of ${origin ?? "no repository"}, not ${repo}; pass --dir <a checkout of ${repo}>`);
  }
  return run("git", ["rev-parse", "--show-toplevel"], { cwd: candidate }).trim();
}

export function pullRequest(repo, number) {
  return JSON.parse(gh(["pr", "view", String(number), "-R", repo, "--json", "number,headRefOid,baseRefName,body,state"]));
}

/**
 * Settings that shape `git diff` output, each pinned on the command line, where
 * `-c` outranks every configuration file, including the repository's own.
 */
export const PINNED_DIFF_SETTINGS = Object.freeze([
  "core.quotePath=false",
  "diff.context=3",
  "diff.interHunkContext=0",
  "diff.indentHeuristic=true",
  "diff.suppressBlankEmpty=false",
  "diff.noprefix=false",
  "diff.mnemonicPrefix=false",
  "diff.relative=false",
  "diff.renames=false",
  "diff.algorithm=myers",
  "diff.submodule=short",
]);

/**
 * The flags that fix the diff's text whatever the settings say; the settings
 * above back them up. `--text` also sets aside git attributes (`-diff`,
 * `binary`), which live in files no `-c` reaches: `.git/info/attributes`,
 * `core.attributesFile` and a `.gitattributes`. A diff driver's own algorithm
 * yields to `--diff-algorithm`, and a hunk header's function context is not
 * part of a patch id.
 */
export const PINNED_DIFF_FLAGS = Object.freeze([
  "--no-color", "--no-ext-diff", "--no-textconv", "--no-renames", "--no-relative", "--binary", "--text",
  "--diff-algorithm=myers", "--unified=3", "--inter-hunk-context=0", "--indent-heuristic",
  "--submodule=short", "--src-prefix=a/", "--dst-prefix=b/",
]);

/**
 * The change's patch id: the diff from the merge base to the head, with every
 * option that changes its text pinned (above), hashed with whitespace kept.
 * Fetches the head by SHA and the base branch first.
 */
export function changeId(dir, { head, base }) {
  const pinned = PINNED_DIFF_SETTINGS.flatMap((setting) => ["-c", setting]);
  const git = (args, input) => run("git", [...pinned, ...args], { cwd: dir, input });
  // The diff is bytes, not text: decoding it would turn every invalid UTF-8
  // sequence into U+FFFD, and two different binary or Latin-1 changes would
  // share a patch id. It goes to patch-id exactly as git wrote it.
  const gitBytes = (args, input) => execFileSync("git", [...pinned, ...args], { cwd: dir, input, maxBuffer: 256 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] });
  try {
    git(["cat-file", "-e", `${head}^{commit}`]);
  } catch {
    git(["fetch", "--quiet", "--no-tags", "origin", head]);
  }
  git(["fetch", "--quiet", "--no-tags", "origin", `+refs/heads/${base}:refs/remotes/origin/${base}`]);
  const mergeBase = git(["merge-base", `refs/remotes/origin/${base}`, head]).trim();
  const diff = gitBytes(["diff", ...PINNED_DIFF_FLAGS, mergeBase, head]);
  if (diff.length === 0) return "empty";
  return gitBytes(["patch-id", "--verbatim"], diff).toString("latin1").trim().split(/\s+/)[0];
}

/** The pull request's comments, oldest first. */
export function reviewComments(repo, number) {
  const out = gh(["api", "--paginate", `repos/${repo}/issues/${number}/comments`, "--jq", ".[] | {author: .user.login, url: .html_url, body}"]);
  return out.split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

/** Whether an account may write a review that counts: write access or more. A lookup that fails for any other reason than "no access" throws. */
export function canWrite(repo, login, api = gh) {
  try {
    const permission = api(["api", `repos/${repo}/collaborators/${encodeURIComponent(login)}/permission`, "--jq", ".permission"]).trim();
    return WRITE_PERMISSIONS.includes(permission);
  } catch (error) {
    const text = errorText(error);
    if (/HTTP 404|Not Found|is not a user/i.test(text)) return false;
    throw new Error(`cannot read ${login}'s permission on ${repo}: ${text}`);
  }
}

/**
 * Everything a caller needs to judge a pull request's review, from GitHub and
 * the checkout. `lookups` replaces the real ones in tests.
 */
export function readReview({ repo, number, dir, expectHead }, lookups = {}) {
  const look = { pullRequest, changeId, reviewComments, canWrite, checkoutFor, ...lookups };
  const pr = look.pullRequest(repo, number);
  if (expectHead && pr.headRefOid !== expectHead) {
    throw new Error(`#${number}'s head is ${pr.headRefOid}, not ${expectHead}: it moved during this read, and a newer run judges it`);
  }
  const checkout = look.checkoutFor(repo, dir);
  const digest = changeDigest({ changeId: look.changeId(checkout, { head: pr.headRefOid, base: pr.baseRefName }), declarations: declarationText(pr.body) });
  const comments = look.reviewComments(repo, number);
  const known = new Map();
  const trusted = (login) => {
    if (!known.has(login)) known.set(login, look.canWrite(repo, login));
    return known.get(login);
  };
  return { ...reviewState({ comments, digest, trusted }), head: pr.headRefOid, digest, number: pr.number };
}

// ─── Posting a verdict ──────────────────────────────────────────────────

/**
 * Makes the `Review verdict` check judge again after a verdict is posted: a
 * comment fires no pull-request event, so the newest run for the head is
 * rerun once it has finished. A repository without the workflow has nothing
 * to rerun (whatever guards its merges reads the comment at merge time).
 */
export function rejudge(repo, head, api = gh) {
  let runs;
  try {
    runs = JSON.parse(api(["run", "list", "-R", repo, "-w", CHECK_WORKFLOW, "-c", head, "-e", "pull_request", "-L", "1", "--json", "databaseId,status"]));
  } catch (error) {
    const text = errorText(error);
    if (/could not find any workflows|workflow .* not found|HTTP 404/i.test(text)) return `${repo} has no ${CHECK_WORKFLOW}; nothing to rerun`;
    throw error;
  }
  if (runs.length === 0) {
    return `no ${CHECK_WORKFLOW} run exists for ${head.slice(0, 10)}: it was pushed before the workflow existed, or it conflicts with its base (GitHub runs no workflow then). Merge main into the branch and push, or comment \`@dependabot rebase\`, and the new run reads this verdict`;
  }
  const id = String(runs[0].databaseId);
  if (runs[0].status !== "completed") {
    try {
      api(["run", "watch", id, "-R", repo, "--interval", "5"]);
    } catch {
      // A failed run is still a finished run, and rerunning it is the point.
    }
  }
  api(["run", "rerun", id, "-R", repo]);
  return `reran ${CHECK_WORKFLOW} run ${id} for ${head.slice(0, 10)}`;
}

function comment(repo, number, body) {
  const scratch = mkdtempSync(join(tmpdir(), "review-verdict-"));
  try {
    writeFileSync(join(scratch, "review.md"), body);
    gh(["pr", "comment", String(number), "-R", repo, "--body-file", join(scratch, "review.md")]);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * Posts a reviewer's verdict, refusing one whose shape is wrong, or whose
 * head, change or declarations moved during the review. Returns
 * `{ exit, lines }`; `lookups` replaces the real effects in tests.
 */
export function postVerdict({ repo, number, dir, output, reviewedHead, reviewedDigest }, lookups = {}) {
  const look = { pullRequest, checkoutFor, changeId, comment, rejudge, ...lookups };
  const problems = verdictProblems(output);
  if (problems.length > 0) return { exit: 1, lines: [`the verdict is refused: ${problems.join("; ")}`] };
  const pr = look.pullRequest(repo, number);
  if (pr.headRefOid !== reviewedHead) {
    return { exit: 1, lines: [`#${number}'s head is ${pr.headRefOid}, not the reviewed ${reviewedHead}: the pull request moved during the review; review it again`] };
  }
  const checkout = look.checkoutFor(repo, dir);
  const reviewed = changeDigest({ changeId: look.changeId(checkout, { head: pr.headRefOid, base: pr.baseRefName }), declarations: declarationText(pr.body) });
  if (reviewed !== reviewedDigest) {
    return { exit: 1, lines: [`#${number}'s change or declarations moved during the review (digest ${reviewed}, reviewed ${reviewedDigest}); review it again`] };
  }
  look.comment(repo, number, renderReview({ verdict: output.verdict, head: pr.headRefOid, reviewed, reviewer: output.reviewer, findings: output.findings }));
  const posted = `posted ${output.verdict} on ${repo}#${number} at ${pr.headRefOid.slice(0, 10)}`;
  try {
    return { exit: 0, lines: [posted, look.rejudge(repo, pr.headRefOid)] };
  } catch (error) {
    const reason = errorText(error);
    return { exit: 1, lines: [posted, `the verdict is posted, but the check was not made to judge it again: ${reason}; push to the branch (merging main will do) or comment \`@dependabot rebase\`, and the new run reads this verdict (GitHub refuses to rerun a run more than 30 days old)`] };
  }
}

// ─── The command ────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = { mode: undefined, repo: undefined, number: undefined, expectHead: undefined, dir: undefined, verdictFile: undefined, reviewedHead: undefined, reviewedDigest: undefined, json: false };
  const value = (i, name) => {
    if (argv[i + 1] === undefined || argv[i + 1].startsWith("--")) throw new Error(`${name} needs a value`);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--status" || arg === "--write") opts.mode = arg.slice(2);
    else if (arg === "-R" || arg === "--repo") opts.repo = value(i++, arg);
    else if (arg === "--expect-head") opts.expectHead = value(i++, arg);
    else if (arg === "--dir") opts.dir = value(i++, arg);
    else if (arg === "--verdict-file") opts.verdictFile = value(i++, arg);
    else if (arg === "--reviewed-head") opts.reviewedHead = value(i++, arg);
    else if (arg === "--reviewed-digest") opts.reviewedDigest = value(i++, arg);
    else if (arg === "--json") opts.json = true;
    else if (/^\d+$/.test(arg) && opts.number === undefined) opts.number = Number(arg);
    else throw new Error(`unknown argument ${arg}`);
  }
  if (!opts.mode) throw new Error("pass --status or --write");
  if (!/^[\w.-]+\/[\w.-]+$/.test(opts.repo ?? "")) throw new Error("pass -R <owner/repo>");
  if (opts.number === undefined) throw new Error("pass the pull request number");
  if (opts.expectHead !== undefined && !SHA.test(opts.expectHead)) throw new Error("--expect-head takes a full commit SHA");
  if (opts.mode === "write" && (!opts.verdictFile || !SHA.test(opts.reviewedHead ?? "") || !DIGEST.test(opts.reviewedDigest ?? ""))) {
    throw new Error("--write needs --verdict-file <json>, --reviewed-head <full SHA> and --reviewed-digest <sha256:…>, the head and digest `--status --json` printed before the review");
  }
  return opts;
}

function main(argv) {
  const opts = parseArgs(argv);
  if (opts.mode === "write") {
    const output = JSON.parse(readFileSync(opts.verdictFile, "utf8"));
    const { exit, lines } = postVerdict({ ...opts, output });
    for (const line of lines) (exit === 0 ? console.log : console.error)(`review-verdict: ${line}`);
    return exit;
  }
  const result = readReview(opts);
  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else console.log(`review-verdict: ${opts.repo}#${opts.number} at ${result.head.slice(0, 10)}: ${result.state}: ${result.reason}`);
  return result.state === "current" ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`review-verdict: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}
