// Tests for scripts/review-verdict.mjs: the review verdict a pull request needs
// before it merges.
// Run via `node --test scripts/review-verdict.test.mjs` (wired into root `npm test`).
//
// What these guard: which comments are reviews and which reviews are malformed;
// that the digest follows the change and the declarations and nothing else;
// that the newest review by a writer decides, and a review by anyone else is
// ignored; that a reviewer's output is refused when it could not be posted
// honestly; that a posted comment parses back to what was posted; and, through
// throwaway git repositories, that the change id survives a merge of the base
// and moves with any edit to the change.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  changeDigest,
  changeId,
  declarationText,
  parseReview,
  readReview,
  renderReview,
  reviewState,
  verdictProblems,
} from "./review-verdict.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "review-verdict.mjs");
const HEAD = "a".repeat(40);
const DIGEST = `sha256:${"b".repeat(64)}`;
const OTHER_DIGEST = `sha256:${"c".repeat(64)}`;

function review({ verdict = "approve", head = HEAD, reviewed = DIGEST, findings = "Findings: none" } = {}) {
  return ["## Review", "", `Verdict: ${verdict}`, `Head: ${head}`, `Reviewed: ${reviewed}`, "Reviewer: claude-opus-5-5, fresh context, review-pull-request", findings].join("\n");
}

const writers = new Set(["owner"]);
const trusted = (login) => writers.has(login);

// ─── parseReview ────────────────────────────────────────────────────────

test("a comment that does not open with the heading is not a review", () => {
  assert.equal(parseReview("Thanks, looks good"), undefined);
  assert.equal(parseReview("Some text\n## Review\nVerdict: approve"), undefined);
  assert.equal(parseReview(""), undefined);
});

test("a well-formed review parses with no problems", () => {
  const parsed = parseReview(review());
  assert.deepEqual(parsed.problems, []);
  assert.equal(parsed.verdict, "approve");
  assert.equal(parsed.head, HEAD);
  assert.equal(parsed.reviewed, DIGEST);
  assert.deepEqual(parsed.findings, []);
});

test("leading blank lines and CRLF line ends still parse", () => {
  assert.deepEqual(parseReview(`\n\n${review().replace(/\n/g, "\r\n")}`).problems, []);
});

test("findings listed under the Findings key are read", () => {
  const parsed = parseReview(review({ verdict: "changes-needed", findings: "Findings:\n- a.ts:3 (blocking) crashes on empty input\n- b.ts (minor) typo" }));
  assert.deepEqual(parsed.problems, []);
  assert.deepEqual(parsed.findings, ["a.ts:3 (blocking) crashes on empty input", "b.ts (minor) typo"]);
});

test("each malformed field is named", () => {
  const cases = [
    [review({ verdict: "lgtm" }), /Verdict must be one of/],
    [review({ head: "abc123" }), /Head must be a full commit SHA/],
    [review({ reviewed: "deadbeef" }), /Reviewed must be sha256/],
    [review({ findings: "" }).replace(/\n$/, ""), /Findings is missing|Findings lists nothing/],
    [review({ findings: "Findings: none\n- a.ts stray" }), /says none and lists findings/],
    [review({ findings: "Findings: some" }), /Findings is `none` or a list/],
    [`${review()}\nVerdict: approve`, /Verdict appears twice/],
    [`${review()}\nand one more thing`, /unexpected line/],
    [review().replace(/^Reviewer:.*$/m, ""), /Reviewer is missing/],
  ];
  for (const [body, pattern] of cases) {
    const problems = parseReview(body).problems;
    assert.ok(problems.some((p) => pattern.test(p)), `${pattern} in ${JSON.stringify(problems)}`);
  }
});

// ─── The digest ─────────────────────────────────────────────────────────

test("the digest is stable, and follows the change id", () => {
  const a = changeDigest({ changeId: "1234", declarations: "" });
  assert.equal(a, changeDigest({ changeId: "1234", declarations: "" }));
  assert.match(a, /^sha256:[0-9a-f]{64}$/);
  assert.notEqual(a, changeDigest({ changeId: "5678", declarations: "" }));
  assert.throws(() => changeDigest({ changeId: "", declarations: "" }), /no change id/);
});

test("a declaration added or reworded moves the digest; other body text does not", () => {
  const body = "## Summary\nWhat it does.\n\nTest-removal: old case -- replaced by the new one\n";
  const base = changeDigest({ changeId: "1234", declarations: declarationText(body) });
  const prose = body.replace("What it does.", "What it does, said differently.");
  assert.equal(changeDigest({ changeId: "1234", declarations: declarationText(prose) }), base);
  const reworded = body.replace("replaced by the new one", "no longer needed");
  assert.notEqual(changeDigest({ changeId: "1234", declarations: declarationText(reworded) }), base);
  const added = `${body}Skip: another case -- needs a live model\n`;
  assert.notEqual(changeDigest({ changeId: "1234", declarations: declarationText(added) }), base);
});

test("declarationText reads all three kinds through the integrity tool's parser", () => {
  const text = declarationText("Test-removal: a -- gone\nQuarantine: b -- stigmer#12\nSkip: c -- not here\n");
  assert.equal(text, "Test-removal: a -- gone\nQuarantine: b -- stigmer#12\nSkip: c -- not here");
  assert.equal(declarationText(undefined), "");
});

// ─── reviewState ────────────────────────────────────────────────────────

const comment = (author, body, url = "https://example.test/c") => ({ author, body, url });

test("no review comment by a writer is missing", () => {
  assert.equal(reviewState({ comments: [], digest: DIGEST, trusted }).state, "missing");
  assert.equal(reviewState({ comments: [comment("owner", "LGTM")], digest: DIGEST, trusted }).state, "missing");
});

test("a review by an account without write access is ignored, and said so", () => {
  const result = reviewState({ comments: [comment("drive-by", review())], digest: DIGEST, trusted });
  assert.equal(result.state, "missing");
  assert.match(result.reason, /1 review comment\(s\) by accounts without write access ignored/);
});

test("a writer's approve whose digest is the digest now is current", () => {
  assert.equal(reviewState({ comments: [comment("owner", review())], digest: DIGEST, trusted }).state, "current");
});

test("an approve for another change or other declarations is stale", () => {
  const result = reviewState({ comments: [comment("owner", review())], digest: OTHER_DIGEST, trusted });
  assert.equal(result.state, "stale");
  assert.match(result.reason, /read a different change/);
});

test("the newest writer's review decides, in either direction", () => {
  const approveThenChanges = [comment("owner", review()), comment("owner", review({ verdict: "changes-needed", findings: "Findings:\n- a.ts:1 (blocking) wrong" }))];
  assert.equal(reviewState({ comments: approveThenChanges, digest: DIGEST, trusted }).state, "changes-needed");
  const changesThenApprove = [...approveThenChanges].reverse();
  assert.equal(reviewState({ comments: changesThenApprove, digest: DIGEST, trusted }).state, "current");
});

test("a newer review by a non-writer does not override a writer's", () => {
  const comments = [comment("owner", review({ verdict: "changes-needed", findings: "Findings:\n- a.ts (blocking) wrong" })), comment("drive-by", review())];
  assert.equal(reviewState({ comments, digest: DIGEST, trusted }).state, "changes-needed");
});

test("a changes-needed for an earlier change is stale, so the next step is a new review", () => {
  const comments = [comment("owner", review({ verdict: "changes-needed", findings: "Findings:\n- a.ts (blocking) wrong" }))];
  assert.equal(reviewState({ comments, digest: OTHER_DIGEST, trusted }).state, "stale");
});

test("a malformed newest review is invalid, never current", () => {
  const comments = [comment("owner", review()), comment("owner", review({ head: "short" }))];
  assert.equal(reviewState({ comments, digest: DIGEST, trusted }).state, "invalid");
});

// ─── The reviewer's output and the posted comment ───────────────────────

test("a reviewer's output that could not be posted honestly is refused", () => {
  assert.deepEqual(verdictProblems({ verdict: "approve", reviewer: "claude-opus-5-5", findings: [] }), []);
  const cases = [
    [null, /not a JSON object/],
    [{ verdict: "ok", reviewer: "m", findings: [] }, /verdict must be one of/],
    [{ verdict: "approve", reviewer: "", findings: [] }, /reviewer names the model/],
    [{ verdict: "approve", reviewer: "m" }, /findings is a list/],
    [{ verdict: "approve", reviewer: "m", findings: [{ path: "a.ts", severity: "blocking", summary: "x" }] }, /approve cannot carry a blocking finding/],
    [{ verdict: "changes-needed", reviewer: "m", findings: [{ path: "a.ts", severity: "major", summary: "x" }] }, /severity must be one of/],
    [{ verdict: "changes-needed", reviewer: "m", findings: [{ path: "a.ts", line: "3", severity: "minor", summary: "x" }] }, /line is not a line number/],
    [{ verdict: "changes-needed", reviewer: "m", findings: [{ severity: "minor", summary: "x" }] }, /path is missing/],
    [{ verdict: "changes-needed", reviewer: "m", findings: [{ path: "a.ts", severity: "minor" }] }, /summary is missing/],
  ];
  for (const [output, pattern] of cases) {
    const problems = verdictProblems(output);
    assert.ok(problems.some((p) => pattern.test(p)), `${pattern} in ${JSON.stringify(problems)}`);
  }
});

test("a rendered verdict parses back to what was posted, with each finding on one line", () => {
  const findings = [
    { path: "a.ts", line: 3, severity: "blocking", summary: "crashes\non empty input" },
    { path: "b.ts", severity: "minor", summary: "typo" },
  ];
  const body = renderReview({ verdict: "changes-needed", head: HEAD, reviewed: DIGEST, reviewer: "claude-opus-5-5", findings });
  const parsed = parseReview(body);
  assert.deepEqual(parsed.problems, []);
  assert.equal(parsed.verdict, "changes-needed");
  assert.deepEqual(parsed.findings, ["a.ts:3 (blocking) crashes on empty input", "b.ts (minor) typo"]);
  const clean = parseReview(renderReview({ verdict: "approve", head: HEAD, reviewed: DIGEST, reviewer: "m", findings: [] }));
  assert.deepEqual(clean.problems, []);
  assert.deepEqual(clean.findings, []);
});

// ─── readReview, with the lookups replaced ──────────────────────────────

function fakeLookups({ head = HEAD, body = "", comments = [], permissions = { owner: true } } = {}) {
  const calls = { canWrite: [] };
  return {
    calls,
    lookups: {
      pullRequest: () => ({ number: 7, headRefOid: head, baseRefName: "main", body }),
      checkoutFor: () => "/checkout",
      changeId: () => "1234",
      reviewComments: () => comments,
      canWrite: (_repo, login) => {
        calls.canWrite.push(login);
        return permissions[login] ?? false;
      },
    },
  };
}

test("readReview binds the digest to the change and the body's declarations", () => {
  const digest = changeDigest({ changeId: "1234", declarations: declarationText("Skip: a -- b") });
  const { lookups } = fakeLookups({ body: "Skip: a -- b", comments: [comment("owner", review({ reviewed: digest }))] });
  const result = readReview({ repo: "stigmer/stigmer", number: 7 }, lookups);
  assert.equal(result.state, "current");
  assert.equal(result.digest, digest);
});

test("readReview refuses when the head moved during the read", () => {
  const { lookups } = fakeLookups();
  assert.throws(() => readReview({ repo: "stigmer/stigmer", number: 7, expectHead: "d".repeat(40) }, lookups), /moved during this read/);
});

test("readReview asks for each author's permission once", () => {
  const { lookups, calls } = fakeLookups({ comments: [comment("owner", review()), comment("owner", review()), comment("drive-by", review())] });
  readReview({ repo: "stigmer/stigmer", number: 7 }, lookups);
  assert.deepEqual(calls.canWrite, ["owner", "drive-by"]);
});

test("a failed permission lookup is not a pass", () => {
  const { lookups } = fakeLookups({ comments: [comment("owner", review())] });
  lookups.canWrite = () => {
    throw new Error("cannot read owner's permission");
  };
  assert.throws(() => readReview({ repo: "stigmer/stigmer", number: 7 }, lookups), /cannot read/);
});

// ─── The change id, through real git ────────────────────────────────────

function git(dir, ...args) {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd: dir, encoding: "utf8" }).trim();
}

function repositories() {
  const root = mkdtempSync(join(tmpdir(), "review-verdict-test-"));
  const origin = join(root, "origin.git");
  const work = join(root, "work");
  execFileSync("git", ["init", "--quiet", "--bare", "--initial-branch=main", origin]);
  execFileSync("git", ["clone", "--quiet", origin, work], { stdio: "ignore" });
  const lines = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`);
  writeFileSync(join(work, "file.txt"), `${lines.join("\n")}\n`);
  writeFileSync(join(work, "other.txt"), "other\n");
  git(work, "add", ".");
  git(work, "commit", "--quiet", "-m", "base");
  git(work, "push", "--quiet", "origin", "HEAD:main");
  return { root, work, lines };
}

test("the change id survives a merge of the base that leaves the change alone, and moves with the change", () => {
  const { root, work, lines } = repositories();
  try {
    git(work, "switch", "--quiet", "-c", "topic");
    const changed = [...lines];
    changed[30] = "line 31, changed by the pull request";
    writeFileSync(join(work, "file.txt"), `${changed.join("\n")}\n`);
    git(work, "commit", "--quiet", "-am", "the change");
    const first = changeId(work, { head: git(work, "rev-parse", "HEAD"), base: "main" });
    assert.match(first, /^[0-9a-f]{40}$/);

    // main gains an unrelated change far from the hunk, and the branch merges it
    git(work, "switch", "--quiet", "main");
    const mainLines = [...lines];
    mainLines[2] = "line 3, changed on main";
    writeFileSync(join(work, "file.txt"), `${mainLines.join("\n")}\n`);
    writeFileSync(join(work, "other.txt"), "other, changed on main\n");
    git(work, "commit", "--quiet", "-am", "main moves");
    git(work, "push", "--quiet", "origin", "HEAD:main");
    git(work, "switch", "--quiet", "topic");
    git(work, "merge", "--quiet", "--no-edit", "main");
    const merged = changeId(work, { head: git(work, "rev-parse", "HEAD"), base: "main" });
    assert.equal(merged, first, "a merge of main that leaves the change alone keeps the change id");

    // any edit to the change moves it
    changed[2] = mainLines[2];
    changed[30] = "line 31, changed again";
    writeFileSync(join(work, "file.txt"), `${changed.join("\n")}\n`);
    git(work, "commit", "--quiet", "-am", "the change, edited");
    const edited = changeId(work, { head: git(work, "rev-parse", "HEAD"), base: "main" });
    assert.notEqual(edited, first);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a base change beside the change's hunk moves the change id, so the reviewer reads the new context", () => {
  const { root, work, lines } = repositories();
  try {
    git(work, "switch", "--quiet", "-c", "topic");
    const changed = [...lines];
    changed[20] = "line 21, changed by the pull request";
    writeFileSync(join(work, "file.txt"), `${changed.join("\n")}\n`);
    git(work, "commit", "--quiet", "-am", "the change");
    const first = changeId(work, { head: git(work, "rev-parse", "HEAD"), base: "main" });

    // main changes a line two away from the hunk: inside its context
    git(work, "switch", "--quiet", "main");
    const mainLines = [...lines];
    mainLines[18] = "line 19, changed on main";
    writeFileSync(join(work, "file.txt"), `${mainLines.join("\n")}\n`);
    git(work, "commit", "--quiet", "-am", "main moves beside the change");
    git(work, "push", "--quiet", "origin", "HEAD:main");
    git(work, "switch", "--quiet", "topic");
    git(work, "merge", "--quiet", "--no-edit", "main");
    assert.notEqual(changeId(work, { head: git(work, "rev-parse", "HEAD"), base: "main" }), first);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a branch with no change has the empty change id", () => {
  const { root, work } = repositories();
  try {
    assert.equal(changeId(work, { head: git(work, "rev-parse", "HEAD"), base: "main" }), "empty");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ─── The command ────────────────────────────────────────────────────────

test("the command refuses a malformed invocation with exit 2", () => {
  const cases = [
    [[], /pass --status or --write/],
    [["--status", "7"], /pass -R/],
    [["--status", "-R", "stigmer/stigmer"], /pull request number/],
    [["--status", "-R", "stigmer/stigmer", "7", "--expect-head", "abc"], /full commit SHA/],
    [["--write", "-R", "stigmer/stigmer", "7"], /--write needs/],
    [["--status", "-R", "stigmer/stigmer", "7", "--bogus"], /unknown argument/],
  ];
  for (const [args, pattern] of cases) {
    const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
    assert.equal(result.status, 2, `${args.join(" ")}: ${result.stderr}`);
    assert.match(result.stderr, pattern);
  }
});
