#!/usr/bin/env node

/**
 * Reads and writes the review verdicts a pull request needs before it merges.
 *
 * Every pull request is read once in full, before it merges, by a reviewer
 * that did not write it: a fresh agent given only the pull request and the
 * brief in `.agents/skills/review-pull-request/SKILL.md`. Every push after
 * that review is read by a fix-check: a fresh agent that reads only what the
 * push changed and answers each open blocking finding. A verdict is either of
 * the two. Each is posted on the pull request as a comment, by this script and
 * never by hand. A review:
 *
 *   ## Review
 *   <!-- review-verdict -->
 *
 *   Verdict: approve
 *   Head: <the head commit the reviewer read>
 *   Reviewed: sha256:<digest>
 *   Reviewer: <model>, fresh context, review-pull-request
 *   Security: none found (<the security questions the change touched>)
 *   Findings: none
 *
 * `Security:` is the reviewer's answer to the questions in
 * `.agents/skills/review-change-security/SKILL.md`: `none found` with the
 * questions it read the change against, or the concern. Every verdict is
 * written with it; a review posted before the line existed is read without it,
 * so a pull request approved then stays approved until its change moves.
 *
 * A fix-check:
 *
 *   ## Fix check
 *   <!-- review-fix-check -->
 *
 *   Verdict: resolved | unresolved | needs-review
 *   Head: <the head commit the fix-check read>
 *   Reviewed: sha256:<digest>
 *   Continues: sha256:<the Reviewed digest of the verdict it answers>
 *   Reviewer: <model>, fresh context, review-pull-request fix-check
 *   Security: none found (<the security questions the push touched>)
 *   Answers:
 *   - resolved <a blocking finding, exactly as its verdict posted it>
 *   - unresolved <another> -- note: <why it is still open>
 *   Findings: none
 *
 * `Answers:` names every open blocking finding, or is `none` when nothing is
 * open (a push after an approve). `Findings:` lists the push's own blocking
 * regressions, or is `none`. `resolved` needs every answer resolved and no
 * regression; `needs-review` says the push added behaviour no finding asked
 * for, and sends the change back to one new full review.
 *
 * The marker line under the heading is what makes a comment a verdict, so a
 * person's own "## Review" notes are never read as one.
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
 *   - the declarations the body carries: every kind the test-integrity
 *     tool's own parser reads (`parseDeclarations`, over its `DECLARATION`
 *     grammar; `Test-removal:` and `Coverage-drop:` among them), since the
 *     reviewer judges each one. A kind added there is bound here with no
 *     change to this file.
 * Any edit to the change, or a declaration added, removed or changed in what
 * it names (every field the integrity tool reads from it, for every kind it
 * parses), makes the verdict stale, and the pull request needs a new
 * verdict: a fix-check of the push. The digest is taken before the reading
 * and posted only if it has not moved since, so a declaration added while the
 * reviewer reads is never approved unread.
 *
 * The verdicts by writers form a chain: the newest review, then the
 * fix-checks posted after it, each continuing the one before. Fix-checks
 * before that review are history. The open blocking findings are the
 * review's, plus each fix-check's regressions, less those a fix-check answered
 * resolved; each fix-check answers exactly the ones open before it. The state
 * of a pull request is the newest link of its chain:
 *   current         an approve, or a resolved fix-check, and its digest is the digest now
 *   stale           its digest is not the digest now (new code, or a new declaration): a fix-check reads the push
 *   changes-needed  a blocking finding is open on exactly this change
 *   invalid         a link does not parse, or does not continue the chain
 *   missing         no review by a writer, or a fix-check asked for a new full review
 *
 * What the check proves is that an account with write access posted a current
 * verdict. That the reviewer did not write the change rests on the procedure
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
 *     "security": "none found (<the questions touched>)" | "<the concern>",
 *     "findings": [{ "path": "...", "line": 1, "severity": "blocking" | "minor", "summary": "..." }] }
 * or the fix-check's, which `--write` reads by its `check`:
 *   { "check": "fix", "verdict": "resolved" | "unresolved" | "needs-review",
 *     "reviewer": "<model>", "security": "...", "continues": "sha256:<…>",
 *     "answers": [{ "finding": "<as posted>", "resolved": true, "note": "..." }],
 *     "regressions": [{ "path": "...", "line": 1, "summary": "..." }] }
 * A fix-check is posted only when it continues the newest verdict by a writer
 * and answers exactly the open blocking findings.
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
export const FIX_HEADING = "## Fix check";
export const FIX_MARKER = "<!-- review-fix-check -->";
export const FIX_VERDICTS = Object.freeze(["resolved", "unresolved", "needs-review"]);
export const SEVERITIES = Object.freeze(["blocking", "minor"]);
export const WRITE_PERMISSIONS = Object.freeze(["admin", "maintain", "write"]);
export const CHECK_WORKFLOW = "ci.review.yaml";

const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const KEY_LINE = /^([A-Z][A-Za-z-]*):[ \t]*(.*)$/;
const FINDING_LINE = /^-[ \t]+(.+)$/;
const ANSWER = /^(resolved|unresolved)[ \t]+(.+)$/;
const NOTE = " -- note: ";
const SEVERITY_TAG = / \((blocking|minor)\) /;
const SCRIPT = fileURLToPath(import.meta.url);

// ─── The verdict ────────────────────────────────────────────────────────

/**
 * Reads a comment that opens with `heading` and `marker` into its key lines
 * and the `- ` items under each key in `listKeys`. Returns undefined for any
 * other comment.
 */
function readComment(body, heading, marker, listKeys) {
  const lines = (body ?? "").replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;
  if (lines[i]?.trim() !== heading) return undefined;
  let j = i + 1;
  while (j < lines.length && lines[j].trim() === "") j++;
  if (lines[j]?.trim() !== marker) return undefined;

  const fields = new Map();
  const lists = new Map(listKeys.map((name) => [name, []]));
  const problems = [];
  let list;
  for (const raw of lines.slice(j + 1)) {
    const line = raw.trimEnd();
    if (line.trim() === "") continue;
    const key = KEY_LINE.exec(line);
    if (key) {
      if (fields.has(key[1])) problems.push(`${key[1]} appears twice`);
      fields.set(key[1], key[2].trim());
      list = lists.get(key[1]);
      continue;
    }
    const item = FINDING_LINE.exec(line.trim());
    if (list && item) list.push(item[1]);
    else problems.push(`unexpected line: ${line.trim().slice(0, 80)}`);
  }
  return { fields, lists, problems };
}

/** The problems of a key whose value is `none` or a list of `- ` items below it. */
function listProblems(name, value, items) {
  if (value === undefined) return [`${name} is missing`];
  if (value === "none" && items.length > 0) return [`${name} says none and lists ${name.toLowerCase()}`];
  if (value !== "none" && value !== "") return [`${name} is \`none\` or a list below it`];
  if (value === "" && items.length === 0) return [`${name} lists nothing; write \`none\``];
  return [];
}

/** The problems of the fields every verdict carries. */
function commonProblems(fields) {
  const problems = [];
  if (!SHA.test(fields.get("Head") ?? "")) problems.push("Head must be a full commit SHA");
  if (!DIGEST.test(fields.get("Reviewed") ?? "")) problems.push("Reviewed must be sha256:<64 hex>");
  if (!fields.get("Reviewer")) problems.push("Reviewer is missing");
  if (fields.get("Security") === "") problems.push("Security is empty");
  return problems;
}

/**
 * Parses a comment body as a review. Returns undefined for a comment that is
 * not a review (it does not open with the heading), else the fields and every
 * problem found; a review with problems is invalid, never current.
 */
export function parseReview(body) {
  const read = readComment(body, HEADING, MARKER, ["Findings"]);
  if (!read) return undefined;
  const { fields, lists } = read;
  const verdict = fields.get("Verdict");
  const findings = lists.get("Findings");
  const problems = [...read.problems];
  if (!VERDICTS.includes(verdict)) problems.push(`Verdict must be one of ${VERDICTS.join(", ")}`);
  problems.push(...commonProblems(fields), ...listProblems("Findings", fields.get("Findings"), findings));
  return { verdict, head: fields.get("Head"), reviewed: fields.get("Reviewed"), reviewer: fields.get("Reviewer"), security: fields.get("Security"), findings, problems };
}

/** The open blocking findings a verdict's `Findings:` lines name, as posted. */
export function blockingFindings(findings) {
  return findings.filter((line) => SEVERITY_TAG.exec(line)?.[1] === "blocking");
}

/** The problems of a fix-check's verdict against its answers and regressions. */
function fixVerdictProblems(verdict, answers, regressions) {
  const open = answers.some((answer) => !answer.resolved) || regressions > 0;
  if (verdict === "resolved" && open) return ["resolved needs every answer resolved and no regression"];
  if (verdict === "unresolved" && !open) return ["unresolved needs an unresolved answer or a regression"];
  return [];
}

/**
 * Parses a comment body as a fix-check. Returns undefined for a comment that
 * is not one, else the fields, its answers (`{ resolved, finding, note }`),
 * its regressions as posted, and every problem found.
 */
export function parseFixCheck(body) {
  const read = readComment(body, FIX_HEADING, FIX_MARKER, ["Answers", "Findings"]);
  if (!read) return undefined;
  const { fields, lists } = read;
  const verdict = fields.get("Verdict");
  const continues = fields.get("Continues");
  const security = fields.get("Security");
  const findings = lists.get("Findings");
  const problems = [...read.problems];
  const answers = [];
  for (const line of lists.get("Answers")) {
    const answer = ANSWER.exec(line);
    if (!answer) {
      problems.push(`each answer opens with resolved or unresolved: ${line.slice(0, 80)}`);
      continue;
    }
    const at = answer[2].lastIndexOf(NOTE);
    answers.push({ resolved: answer[1] === "resolved", finding: at < 0 ? answer[2] : answer[2].slice(0, at), note: at < 0 ? undefined : answer[2].slice(at + NOTE.length) });
  }
  if (!FIX_VERDICTS.includes(verdict)) problems.push(`Verdict must be one of ${FIX_VERDICTS.join(", ")}`);
  problems.push(...commonProblems(fields));
  if (!DIGEST.test(continues ?? "")) problems.push("Continues must be sha256:<64 hex>, the Reviewed digest of the verdict it answers");
  if (security === undefined) problems.push("Security is missing");
  problems.push(...listProblems("Answers", fields.get("Answers"), lists.get("Answers")), ...listProblems("Findings", fields.get("Findings"), findings));
  for (const line of findings) if (SEVERITY_TAG.exec(line)?.[1] !== "blocking") problems.push(`a regression is blocking: ${line.slice(0, 80)}`);
  problems.push(...fixVerdictProblems(verdict, answers, findings.length));
  return { verdict, head: fields.get("Head"), reviewed: fields.get("Reviewed"), continues, reviewer: fields.get("Reviewer"), security, answers, findings, problems };
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

/** What one finding list lacks and what it adds against another, each as posted. */
function findingsDiff(expected, given) {
  const left = [...expected];
  const extra = [];
  for (const finding of given) {
    const at = left.indexOf(finding);
    if (at < 0) extra.push(finding);
    else left.splice(at, 1);
  }
  return { missing: left, extra };
}

/** Why a fix-check's answers are not exactly the open findings, or undefined when they are. */
function answersMismatch(open, answers) {
  const { missing, extra } = findingsDiff(open, answers.map((answer) => answer.finding));
  if (missing.length === 0 && extra.length === 0) return undefined;
  const parts = [];
  if (missing.length > 0) parts.push(`unanswered: ${missing.join(" | ")}`);
  if (extra.length > 0) parts.push(`not open: ${extra.join(" | ")}`);
  return `a fix-check must answer exactly the open blocking findings; ${parts.join("; ")}`;
}

/** The findings still open after a fix-check: its unresolved answers and its regressions. */
function openAfter(fix) {
  return [...fix.answers.filter((answer) => !answer.resolved).map((answer) => answer.finding), ...fix.findings];
}

/**
 * The state of a pull request from its comments, oldest first, each
 * `{ author, body, url }`. `trusted(login)` says whether an author may write
 * a verdict that counts. The newest link of the chain by trusted authors
 * decides (the header has the chain). The result carries that link as
 * `review` (its `kind` is `review` or `fix-check`) and, when the chain reads,
 * the blocking findings open after it as `open`.
 */
export function reviewState({ comments, digest, trusted }) {
  const links = [];
  let ignored = 0;
  for (const comment of comments) {
    const review = parseReview(comment.body);
    const fix = review ? undefined : parseFixCheck(comment.body);
    if (!review && !fix) continue;
    if (!trusted(comment.author)) {
      ignored++;
      continue;
    }
    links.push({ ...(review ?? fix), kind: review ? "review" : "fix-check", author: comment.author, url: comment.url });
  }
  const aside = ignored > 0 ? ` (${ignored} review comment(s) by accounts without write access ignored)` : "";
  const start = links.findLastIndex((link) => link.kind === "review");
  if (start < 0) return { state: "missing", reason: `no review by an account with write access${aside}` };
  const chain = links.slice(start);
  const newest = chain.at(-1);
  const at = newest.url ? ` (${newest.url})` : "";
  let open = [];
  for (const [i, link] of chain.entries()) {
    const where = link.url ? ` (${link.url})` : "";
    if (link.problems.length > 0) {
      const which = link === newest ? `the newest ${link.kind}` : `a ${link.kind} in the chain`;
      return { state: "invalid", reason: `${which} does not parse: ${link.problems.join("; ")}${where}`, review: newest };
    }
    if (link.kind === "review") {
      open = blockingFindings(link.findings);
      continue;
    }
    if (link.continues !== chain[i - 1].reviewed) {
      return { state: "invalid", reason: `a fix-check continues ${link.continues}, not the verdict before it (${chain[i - 1].reviewed})${where}`, review: newest };
    }
    const mismatch = answersMismatch(open, link.answers);
    if (mismatch) return { state: "invalid", reason: `${mismatch}${where}`, review: newest };
    open = openAfter(link);
  }
  // Whatever was pushed since, new behaviour asks for a full read, never a fix-check.
  if (newest.kind === "fix-check" && newest.verdict === "needs-review") {
    return { state: "missing", reason: `the newest fix-check found new behaviour no finding asked for; the change needs one new full review${at}`, review: newest, open };
  }
  if (newest.reviewed !== digest) {
    return {
      state: "stale",
      reason: `the newest ${newest.kind} (${newest.verdict}, head ${newest.head.slice(0, 10)}) read a different change or different declarations; a fix-check reads the push${at}`,
      review: newest,
      open,
    };
  }
  if (open.length > 0) {
    const who = newest.kind === "review" ? "the reviewer asked for changes to this change" : `the fix-check found ${open.length} blocking finding(s) still open`;
    return { state: "changes-needed", reason: `${who}${at}`, review: newest, open };
  }
  const by = newest.kind === "review" ? `approved by ${newest.reviewer}` : `every finding resolved, by a fix-check (${newest.reviewer})`;
  return { state: "current", reason: `${by}${at}`, review: newest, open };
}

const SECURITY_PROBLEM = "security answers the review-change-security questions: `none found` with the questions read, or the concern";

/** The problems of the fields a reviewer's and a fix-check's output share. */
function outputProblems(output, verdicts) {
  const problems = [];
  if (!verdicts.includes(output.verdict)) problems.push(`verdict must be one of ${verdicts.join(", ")}`);
  if (typeof output.reviewer !== "string" || output.reviewer.trim() === "") problems.push("reviewer names the model that reviewed");
  if (typeof output.security !== "string" || output.security.trim() === "") problems.push(SECURITY_PROBLEM);
  return problems;
}

/** Checks a reviewer's or a fix-check's JSON output; returns the problems, empty when it can be posted. */
export function verdictProblems(output) {
  if (!output || typeof output !== "object") return ["the verdict is not a JSON object"];
  if (output.check === "fix") return fixCheckProblems(output);
  if (output.check !== undefined) return ['check is "fix" for a fix-check, or absent for a review'];
  const problems = outputProblems(output, VERDICTS);
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

/** Checks a fix-check's JSON output; returns the problems, empty when it can be posted. */
export function fixCheckProblems(output) {
  if (!output || typeof output !== "object") return ["the fix-check is not a JSON object"];
  const problems = outputProblems(output, FIX_VERDICTS);
  if (!DIGEST.test(output.continues ?? "")) problems.push("continues is the Reviewed digest (sha256:<64 hex>) of the verdict the fix-check answers");
  const answers = Array.isArray(output.answers) ? output.answers : [];
  const regressions = Array.isArray(output.regressions) ? output.regressions : [];
  if (!Array.isArray(output.answers)) problems.push("answers is a list (empty when no blocking finding is open)");
  if (!Array.isArray(output.regressions)) problems.push("regressions is a list (empty when there are none)");
  for (const [i, a] of answers.entries()) {
    if (typeof a?.finding !== "string" || a.finding.trim() === "") problems.push(`answers[${i}].finding is missing`);
    if (typeof a?.resolved !== "boolean") problems.push(`answers[${i}].resolved is true or false`);
    if (a?.note !== undefined && typeof a.note !== "string") problems.push(`answers[${i}].note is text`);
  }
  for (const [i, r] of regressions.entries()) {
    if (r?.severity !== undefined && r.severity !== "blocking") problems.push(`regressions[${i}] is blocking; a fix-check reports no minor findings`);
    if (typeof r?.path !== "string" || r.path === "") problems.push(`regressions[${i}].path is missing`);
    if (r?.line !== undefined && !Number.isInteger(r.line)) problems.push(`regressions[${i}].line is not a line number`);
    if (typeof r?.summary !== "string" || r.summary.trim() === "") problems.push(`regressions[${i}].summary is missing`);
  }
  problems.push(...fixVerdictProblems(output.verdict, answers.map((a) => ({ resolved: a?.resolved === true })), regressions.length));
  return problems;
}

const oneLine = (text) => String(text).replace(/\s+/g, " ").trim();
const findingLine = (f, severity) => `${oneLine(f.path)}${f.line ? `:${f.line}` : ""} (${severity}) ${oneLine(f.summary)}`;

/** The comment for a verdict. Each finding is one line, so the comment always parses. */
export function renderReview({ verdict, head, reviewed, reviewer, security, findings }) {
  const lines = [HEADING, MARKER, "", `Verdict: ${verdict}`, `Head: ${head}`, `Reviewed: ${reviewed}`, `Reviewer: ${oneLine(reviewer)}, fresh context, review-pull-request`, `Security: ${oneLine(security)}`];
  if (findings.length === 0) lines.push("Findings: none");
  else {
    lines.push("Findings:");
    for (const f of findings) lines.push(`- ${findingLine(f, f.severity)}`);
  }
  return `${lines.join("\n")}\n`;
}

/** The comment for a fix-check. Each answer and regression is one line, so the comment always parses. */
export function renderFixCheck({ verdict, head, reviewed, continues, reviewer, security, answers, regressions }) {
  const lines = [FIX_HEADING, FIX_MARKER, "", `Verdict: ${verdict}`, `Head: ${head}`, `Reviewed: ${reviewed}`, `Continues: ${continues}`, `Reviewer: ${oneLine(reviewer)}, fresh context, review-pull-request fix-check`, `Security: ${oneLine(security)}`];
  if (answers.length === 0) lines.push("Answers: none");
  else {
    lines.push("Answers:");
    for (const a of answers) lines.push(`- ${a.resolved ? "resolved" : "unresolved"} ${oneLine(a.finding)}${a.note ? `${NOTE}${oneLine(a.note)}` : ""}`);
  }
  if (regressions.length === 0) lines.push("Findings: none");
  else {
    lines.push("Findings:");
    for (const r of regressions) lines.push(`- ${findingLine(r, "blocking")}`);
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
 * Why a fix-check cannot continue the pull request's chain as it stands, or
 * undefined when it can: the newest verdict by a writer is the one it names,
 * and its answers are exactly the blocking findings open after that verdict.
 */
function chainRefusal({ repo, number, output, digest }, look) {
  const known = new Map();
  const trusted = (login) => {
    if (!known.has(login)) known.set(login, look.canWrite(repo, login));
    return known.get(login);
  };
  const chain = reviewState({ comments: look.reviewComments(repo, number), digest, trusted });
  if (!chain.review) return `a fix-check continues a review: ${chain.reason}; run the full review`;
  if (chain.state === "invalid") return `the chain does not read: ${chain.reason}`;
  if (chain.state === "missing") return chain.reason;
  if (output.continues !== chain.review.reviewed) {
    return `the fix-check continues ${output.continues}, but the newest verdict on #${number} is ${chain.review.url ?? `the ${chain.review.kind}`} (${chain.review.reviewed}); fix-check that one`;
  }
  return answersMismatch(chain.open, output.answers.map((a) => ({ finding: oneLine(a.finding) })));
}

/**
 * Posts a reviewer's verdict or a fix-check, refusing one whose shape is
 * wrong, whose head, change or declarations moved during the reading, or, for
 * a fix-check, that does not continue the chain. Returns `{ exit, lines }`;
 * `lookups` replaces the real effects in tests.
 */
export function postVerdict({ repo, number, dir, output, reviewedHead, reviewedDigest }, lookups = {}) {
  const look = { pullRequest, checkoutFor, changeId, comment, rejudge, reviewComments, canWrite, ...lookups };
  const problems = verdictProblems(output);
  if (problems.length > 0) return { exit: 1, lines: [`the verdict is refused: ${problems.join("; ")}`] };
  const fix = output.check === "fix";
  const reading = fix ? "the fix-check" : "the review";
  const again = fix ? "fix-check it again" : "review it again";
  const pr = look.pullRequest(repo, number);
  if (pr.headRefOid !== reviewedHead) {
    return { exit: 1, lines: [`#${number}'s head is ${pr.headRefOid}, not the reviewed ${reviewedHead}: the pull request moved during ${reading}; ${again}`] };
  }
  const checkout = look.checkoutFor(repo, dir);
  const reviewed = changeDigest({ changeId: look.changeId(checkout, { head: pr.headRefOid, base: pr.baseRefName }), declarations: declarationText(pr.body) });
  if (reviewed !== reviewedDigest) {
    return { exit: 1, lines: [`#${number}'s change or declarations moved during ${reading} (digest ${reviewed}, reviewed ${reviewedDigest}); ${again}`] };
  }
  if (fix) {
    const refusal = chainRefusal({ repo, number, output, digest: reviewed }, look);
    if (refusal) return { exit: 1, lines: [`the fix-check is refused: ${refusal}`] };
  }
  look.comment(
    repo,
    number,
    fix
      ? renderFixCheck({ verdict: output.verdict, head: pr.headRefOid, reviewed, continues: output.continues, reviewer: output.reviewer, security: output.security, answers: output.answers, regressions: output.regressions })
      : renderReview({ verdict: output.verdict, head: pr.headRefOid, reviewed, reviewer: output.reviewer, security: output.security, findings: output.findings }),
  );
  const posted = `posted ${fix ? "fix-check " : ""}${output.verdict} on ${repo}#${number} at ${pr.headRefOid.slice(0, 10)}`;
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
