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
 *
 *   Verdict: approve
 *   Head: <the head commit the reviewer read>
 *   Reviewed: sha256:<digest>
 *   Reviewer: <model>, fresh context, review-pull-request
 *   Findings: none
 *
 * A comment, not a section of the body, because a comment's author never
 * changes: anyone who opens a pull request writes its body, and any later edit
 * by a maintainer would make a contributor's text look like a maintainer's.
 * A review comment counts only when its author has write access to the
 * repository.
 *
 * The digest binds the verdict to what the reviewer read, not to a commit:
 *   - the change: `git patch-id --stable` of the diff from the merge base to
 *     the head, which ignores line numbers, so merging `main` into a branch
 *     keeps it as long as the change's own hunks and their context are
 *     untouched;
 *   - the declarations the body carries (`Test-removal:`, `Quarantine:`,
 *     `Skip:`), read by the test-integrity tool's own parser, since the
 *     reviewer judges each one.
 * Any edit to the change, or a declaration added or reworded, makes the
 * verdict stale, and the pull request needs a new review.
 *
 * The state of a pull request is its newest review comment by a writer:
 *   current         approve, and its digest is the digest now
 *   stale           its digest is not the digest now (new code, or a new declaration)
 *   changes-needed  the reviewer asked for changes to exactly this change
 *   invalid         the comment does not parse as a review
 *   missing         no review comment by a writer
 *
 * Callers: the `Review verdict` check (.github/workflows/ci.review.yaml), the
 * review and merge skills, and stigmer-cloud's merge hook, which imports
 * `readReview` from its byte-identical copy of this file.
 *
 * Usage:
 *   node scripts/review-verdict.mjs --status -R <owner/repo> <n> [--expect-head <sha>] [--dir <checkout>] [--json]
 *   node scripts/review-verdict.mjs --write -R <owner/repo> <n> --verdict-file <json> --reviewed-head <sha> [--dir <checkout>]
 *
 * `--dir` is a checkout of the pull request's repository, where the diff is
 * computed; it defaults to the checkout this script lives in when that is the
 * same repository. `--verdict-file` holds the reviewer's JSON output:
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

  const fields = new Map();
  const findings = [];
  const problems = [];
  let inFindings = false;
  for (const raw of lines.slice(i + 1)) {
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
  const { removals, quarantines, skips } = parseDeclarations(body ?? "");
  return [
    ...removals.map((d) => `Test-removal: ${d.subject} -- ${d.reason}`),
    ...quarantines.map((d) => `Quarantine: ${d.subject} -- ${d.repo}#${d.issue ?? ""}`),
    ...skips.map((d) => `Skip: ${d.subject} -- ${d.reason}`),
  ].join("\n");
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
  if (output.verdict === "approve" && (output.findings ?? []).some((f) => f?.severity === "blocking")) {
    problems.push("an approve cannot carry a blocking finding");
  }
  return problems;
}

/** The comment for a verdict. Each finding is one line, so the comment always parses. */
export function renderReview({ verdict, head, reviewed, reviewer, findings }) {
  const oneLine = (text) => String(text).replace(/\s+/g, " ").trim();
  const lines = [HEADING, "", `Verdict: ${verdict}`, `Head: ${head}`, `Reviewed: ${reviewed}`, `Reviewer: ${oneLine(reviewer)}, fresh context, review-pull-request`];
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

/** `owner/repo` of a checkout's origin, or undefined. */
export function originRepo(dir) {
  try {
    const url = run("git", ["remote", "get-url", "origin"], { cwd: dir }).trim();
    const match = /[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(url);
    return match ? `${match[1]}/${match[2]}` : undefined;
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
 * The change's patch id: the diff from the merge base to the head, with every
 * option that changes its text pinned, so a user's git configuration cannot
 * move it. Fetches the head by SHA and the base branch first.
 */
export function changeId(dir, { head, base }) {
  const git = (args, input) => run("git", ["-c", "core.quotePath=false", ...args], { cwd: dir, input });
  try {
    git(["cat-file", "-e", `${head}^{commit}`]);
  } catch {
    git(["fetch", "--quiet", "--no-tags", "origin", head]);
  }
  git(["fetch", "--quiet", "--no-tags", "origin", `+refs/heads/${base}:refs/remotes/origin/${base}`]);
  const mergeBase = git(["merge-base", `refs/remotes/origin/${base}`, head]).trim();
  const diff = git([
    "diff", "--no-color", "--no-ext-diff", "--no-textconv", "--no-renames", "--binary",
    "--diff-algorithm=myers", "--src-prefix=a/", "--dst-prefix=b/", mergeBase, head,
  ]);
  if (diff.trim() === "") return "empty";
  return git(["patch-id", "--stable"], diff).trim().split(/\s+/)[0];
}

/** The pull request's comments, oldest first. */
export function reviewComments(repo, number) {
  const out = gh(["api", "--paginate", `repos/${repo}/issues/${number}/comments`, "--jq", ".[] | {author: .user.login, url: .html_url, body}"]);
  return out.split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

/** Whether an account may write a review that counts: write access or more. A lookup that fails for any other reason than "no access" throws. */
export function canWrite(repo, login) {
  try {
    const permission = gh(["api", `repos/${repo}/collaborators/${encodeURIComponent(login)}/permission`, "--jq", ".permission"]).trim();
    return WRITE_PERMISSIONS.includes(permission);
  } catch (error) {
    const text = `${error.stderr ?? ""}${error.message ?? ""}`;
    if (/HTTP 404|Not Found|is not a user/i.test(text)) return false;
    throw new Error(`cannot read ${login}'s permission on ${repo}: ${text.trim().split("\n")[0]}`);
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
 * to rerun (its merge hook reads the comment at merge time).
 */
export function rejudge(repo, head) {
  let runs;
  try {
    runs = JSON.parse(gh(["run", "list", "-R", repo, "-w", CHECK_WORKFLOW, "-c", head, "-e", "pull_request", "-L", "1", "--json", "databaseId,status"]));
  } catch (error) {
    const text = `${error.stderr ?? ""}${error.message ?? ""}`;
    if (/could not find any workflows|workflow .* not found|HTTP 404/i.test(text)) return `${repo} has no ${CHECK_WORKFLOW}; nothing to rerun`;
    throw error;
  }
  if (runs.length === 0) {
    return `no ${CHECK_WORKFLOW} run exists for ${head.slice(0, 10)} (pushed before the workflow existed): merge main into the branch and push, or comment \`@dependabot rebase\`, and the new run reads this verdict`;
  }
  const id = String(runs[0].databaseId);
  if (runs[0].status !== "completed") {
    try {
      run("gh", ["run", "watch", id, "-R", repo, "--interval", "5"]);
    } catch {
      // A failed run is still a finished run, and rerunning it is the point.
    }
  }
  gh(["run", "rerun", id, "-R", repo]);
  return `reran ${CHECK_WORKFLOW} run ${id} for ${head.slice(0, 10)}`;
}

function postVerdict({ repo, number, dir, verdictFile, reviewedHead }) {
  const output = JSON.parse(readFileSync(verdictFile, "utf8"));
  const problems = verdictProblems(output);
  if (problems.length > 0) {
    console.error(`review-verdict: the verdict is refused: ${problems.join("; ")}`);
    return 1;
  }
  const pr = pullRequest(repo, number);
  if (pr.headRefOid !== reviewedHead) {
    console.error(`review-verdict: #${number}'s head is ${pr.headRefOid}, not the reviewed ${reviewedHead}: the pull request moved during the review; review it again`);
    return 1;
  }
  const checkout = checkoutFor(repo, dir);
  const reviewed = changeDigest({ changeId: changeId(checkout, { head: pr.headRefOid, base: pr.baseRefName }), declarations: declarationText(pr.body) });
  const body = renderReview({ verdict: output.verdict, head: pr.headRefOid, reviewed, reviewer: output.reviewer, findings: output.findings });
  const scratch = mkdtempSync(join(tmpdir(), "review-verdict-"));
  try {
    writeFileSync(join(scratch, "review.md"), body);
    gh(["pr", "comment", String(number), "-R", repo, "--body-file", join(scratch, "review.md")]);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  console.log(`review-verdict: posted ${output.verdict} on ${repo}#${number} at ${pr.headRefOid.slice(0, 10)}`);
  console.log(`review-verdict: ${rejudge(repo, pr.headRefOid)}`);
  return 0;
}

// ─── The command ────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = { mode: undefined, repo: undefined, number: undefined, expectHead: undefined, dir: undefined, verdictFile: undefined, reviewedHead: undefined, json: false };
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
    else if (arg === "--json") opts.json = true;
    else if (/^\d+$/.test(arg) && opts.number === undefined) opts.number = Number(arg);
    else throw new Error(`unknown argument ${arg}`);
  }
  if (!opts.mode) throw new Error("pass --status or --write");
  if (!/^[\w.-]+\/[\w.-]+$/.test(opts.repo ?? "")) throw new Error("pass -R <owner/repo>");
  if (opts.number === undefined) throw new Error("pass the pull request number");
  if (opts.expectHead !== undefined && !SHA.test(opts.expectHead)) throw new Error("--expect-head takes a full commit SHA");
  if (opts.mode === "write" && (!opts.verdictFile || !SHA.test(opts.reviewedHead ?? ""))) {
    throw new Error("--write needs --verdict-file <json> and --reviewed-head <full SHA>");
  }
  return opts;
}

function main(argv) {
  const opts = parseArgs(argv);
  if (opts.mode === "write") return postVerdict(opts);
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
