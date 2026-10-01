// Tests for scripts/review-verdict.mjs: the review verdict a pull request needs
// before it merges.
// Run via `node --test scripts/review-verdict.test.mjs` (wired into root `npm test`).
//
// What these guard: which comments are reviews and which reviews are malformed;
// that the digest follows the change and the declarations and nothing else;
// that the newest review by a writer decides, and a review by anyone else is
// ignored; that a reviewer's output is refused when it could not be posted
// honestly, a missing security reading included, while a review posted before
// the Security line existed still reads; that a posted comment parses back to
// what was posted; how a
// permission lookup fails, how a posted verdict makes the check judge again;
// and, through throwaway git repositories, that the change id survives a merge
// of the base, moves with any edit to the change (whitespace included), and
// does not move with a user's diff settings.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  canWrite,
  changeDigest,
  checkoutFor,
  changeId,
  declarationText,
  parseReview,
  postVerdict,
  readReview,
  rejudge,
  renderReview,
  repoFromUrl,
  reviewState,
  verdictProblems,
} from "./review-verdict.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "review-verdict.mjs");
const HEAD = "a".repeat(40);
const DIGEST = `sha256:${"b".repeat(64)}`;
const OTHER_DIGEST = `sha256:${"c".repeat(64)}`;

const SECURITY = "none found (untrusted input, credential destinations)";

// `security: null` writes a review as they were posted before the Security line.
function review({ verdict = "approve", head = HEAD, reviewed = DIGEST, security = `Security: ${SECURITY}`, findings = "Findings: none" } = {}) {
  const lines = ["## Review", "<!-- review-verdict -->", "", `Verdict: ${verdict}`, `Head: ${head}`, `Reviewed: ${reviewed}`, "Reviewer: claude-opus-5-5, fresh context, review-pull-request"];
  if (security !== null) lines.push(security);
  return [...lines, findings].join("\n");
}

const writers = new Set(["owner"]);
const trusted = (login) => writers.has(login);

// ─── parseReview ────────────────────────────────────────────────────────

test("a comment that does not open with the heading and the marker is not a review", () => {
  assert.equal(parseReview("Thanks, looks good"), undefined);
  assert.equal(parseReview("Some text\n## Review\n<!-- review-verdict -->\nVerdict: approve"), undefined);
  assert.equal(parseReview(""), undefined);
  // A person's own review notes under the same heading are not a verdict.
  assert.equal(parseReview("## Review\n\nLooked at the retry path; one question below."), undefined);
  assert.equal(parseReview(review().replace("<!-- review-verdict -->\n", "")), undefined);
});

test("a well-formed review parses with no problems", () => {
  const parsed = parseReview(review());
  assert.deepEqual(parsed.problems, []);
  assert.equal(parsed.verdict, "approve");
  assert.equal(parsed.head, HEAD);
  assert.equal(parsed.reviewed, DIGEST);
  assert.equal(parsed.security, SECURITY);
  assert.deepEqual(parsed.findings, []);
});

test("a review posted before the Security line still parses with no problems", () => {
  const parsed = parseReview(review({ security: null }));
  assert.deepEqual(parsed.problems, []);
  assert.equal(parsed.security, undefined);
  assert.equal(reviewState({ comments: [comment("owner", review({ security: null }))], digest: DIGEST, trusted }).state, "current");
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
    [review({ security: "Security:" }), /Security is empty/],
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

test("declarationText binds every kind the integrity tool parses, with every field", () => {
  const text = declarationText("Test-removal: a -- gone\nQuarantine: b -- stigmer#12\nSkip: c -- not here\nRPC-waiver: d -- proven elsewhere\n");
  assert.equal(
    text,
    [
      'quarantines {"subject":"b","repo":"stigmer","issue":12}',
      'removals {"subject":"a","reason":"gone"}',
      'rpcWaivers {"subject":"d","reason":"proven elsewhere"}',
      'skips {"subject":"c","reason":"not here"}',
    ].join("\n"),
  );
  assert.equal(declarationText(undefined), "");
  const base = changeDigest({ changeId: "1234", declarations: declarationText("") });
  assert.notEqual(changeDigest({ changeId: "1234", declarations: declarationText("RPC-waiver: d -- proven elsewhere") }), base, "an RPC waiver added after an approve moves the digest");
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
  assert.deepEqual(verdictProblems({ verdict: "approve", reviewer: "claude-opus-5-5", security: SECURITY, findings: [] }), []);
  const cases = [
    [null, /not a JSON object/],
    [{ verdict: "ok", reviewer: "m", findings: [] }, /verdict must be one of/],
    [{ verdict: "approve", reviewer: "", findings: [] }, /reviewer names the model/],
    [{ verdict: "approve", reviewer: "m" }, /findings is a list/],
    [{ verdict: "approve", reviewer: "m", findings: [{ path: "a.ts", severity: "blocking", summary: "x" }] }, /approve cannot carry a blocking finding/],
    [{ verdict: "changes-needed", reviewer: "m", findings: [{ path: "a.ts", severity: "major", summary: "x" }] }, /severity must be one of/],
    [{ verdict: "changes-needed", reviewer: "m", findings: [] }, /names at least one blocking finding/],
    [{ verdict: "changes-needed", reviewer: "m", findings: [{ path: "a.ts", severity: "minor", summary: "x" }] }, /names at least one blocking finding/],
    [{ verdict: "changes-needed", reviewer: "m", findings: [{ path: "a.ts", line: "3", severity: "minor", summary: "x" }] }, /line is not a line number/],
    [{ verdict: "changes-needed", reviewer: "m", findings: [{ severity: "minor", summary: "x" }] }, /path is missing/],
    [{ verdict: "changes-needed", reviewer: "m", findings: [{ path: "a.ts", severity: "minor" }] }, /summary is missing/],
    // The security questions are answered on every verdict, either way.
    [{ verdict: "approve", reviewer: "m", findings: [] }, /security answers the review-change-security questions/],
    [{ verdict: "approve", reviewer: "m", security: " ", findings: [] }, /security answers the review-change-security questions/],
    [{ verdict: "approve", reviewer: "m", security: ["none found"], findings: [] }, /security answers the review-change-security questions/],
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
  const security = "the token reaches\nany host whose name contains github.com";
  const body = renderReview({ verdict: "changes-needed", head: HEAD, reviewed: DIGEST, reviewer: "claude-opus-5-5", security, findings });
  const parsed = parseReview(body);
  assert.deepEqual(parsed.problems, []);
  assert.equal(parsed.verdict, "changes-needed");
  assert.equal(parsed.security, "the token reaches any host whose name contains github.com");
  // The reading sits beside the other fields, and the findings stay last.
  assert.match(body, /^Reviewer: .*\nSecurity: .*\nFindings:\n/m);
  assert.deepEqual(parsed.findings, ["a.ts:3 (blocking) crashes on empty input", "b.ts (minor) typo"]);
  const clean = parseReview(renderReview({ verdict: "approve", head: HEAD, reviewed: DIGEST, reviewer: "m", security: SECURITY, findings: [] }));
  assert.deepEqual(clean.problems, []);
  assert.equal(clean.security, SECURITY);
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

// ─── Posting, the permission lookup, and the rerun ──────────────────────

const REVIEWED_BODY = "Skip: a -- b";
const REVIEWED = changeDigest({ changeId: "1234", declarations: declarationText(REVIEWED_BODY) });

function postLookups({ head = HEAD, body = REVIEWED_BODY } = {}) {
  const posted = [];
  return {
    posted,
    lookups: {
      pullRequest: () => ({ number: 7, headRefOid: head, baseRefName: "main", body }),
      checkoutFor: () => "/checkout",
      changeId: () => "1234",
      comment: (_repo, _number, body) => posted.push(body),
      rejudge: () => "reran",
    },
  };
}
const approve = { verdict: "approve", reviewer: "claude-opus-5-5", security: SECURITY, findings: [] };

test("a posted verdict carries the digest of the change and declarations it was given for", () => {
  const { lookups, posted } = postLookups();
  const result = postVerdict({ repo: "stigmer/stigmer", number: 7, output: approve, reviewedHead: HEAD, reviewedDigest: REVIEWED }, lookups);
  assert.equal(result.exit, 0, result.lines.join("; "));
  assert.equal(posted.length, 1);
  const parsed = parseReview(posted[0]);
  assert.deepEqual(parsed.problems, []);
  assert.equal(parsed.reviewed, REVIEWED);
  assert.equal(parsed.security, SECURITY);
  assert.deepEqual(result.lines, ["posted approve on stigmer/stigmer#7 at aaaaaaaaaa", "reran"]);
});

test("a verdict for a head that moved during the review is not posted", () => {
  const { lookups, posted } = postLookups({ head: "d".repeat(40) });
  const result = postVerdict({ repo: "stigmer/stigmer", number: 7, output: approve, reviewedHead: HEAD, reviewedDigest: REVIEWED }, lookups);
  assert.equal(result.exit, 1);
  assert.match(result.lines[0], /moved during the review; review it again/);
  assert.deepEqual(posted, []);
});

test("a declaration added to the body during the review is not approved unread", () => {
  const { lookups, posted } = postLookups({ body: `${REVIEWED_BODY}\nTest-removal: the old case -- replaced` });
  const result = postVerdict({ repo: "stigmer/stigmer", number: 7, output: approve, reviewedHead: HEAD, reviewedDigest: REVIEWED }, lookups);
  assert.equal(result.exit, 1);
  assert.match(result.lines[0], /change or declarations moved during the review/);
  assert.deepEqual(posted, []);
});

test("a posted verdict whose rerun fails says it was posted", () => {
  const { lookups, posted } = postLookups();
  lookups.rejudge = () => {
    const error = new Error("Command failed");
    error.stderr = "run 42 cannot be rerun; its workflow file may be broken";
    throw error;
  };
  const result = postVerdict({ repo: "stigmer/stigmer", number: 7, output: approve, reviewedHead: HEAD, reviewedDigest: REVIEWED }, lookups);
  assert.equal(result.exit, 1);
  assert.equal(posted.length, 1);
  assert.match(result.lines[0], /^posted approve/);
  assert.match(result.lines[1], /the verdict is posted, but the check was not made to judge it again: run 42 cannot be rerun; its workflow file may be broken; push to the branch/);
});

test("a verdict of the wrong shape is not posted", () => {
  const { lookups, posted } = postLookups();
  const result = postVerdict({ repo: "stigmer/stigmer", number: 7, output: { ...approve, findings: [{ path: "a", severity: "blocking", summary: "x" }] }, reviewedHead: HEAD, reviewedDigest: REVIEWED }, lookups);
  assert.equal(result.exit, 1);
  assert.match(result.lines[0], /approve cannot carry a blocking finding/);
  assert.deepEqual(posted, []);
  const { security: _security, ...unanswered } = approve;
  assert.match(postVerdict({ repo: "stigmer/stigmer", number: 7, output: unanswered, reviewedHead: HEAD, reviewedDigest: REVIEWED }, lookups).lines[0], /security answers the review-change-security questions/);
  assert.deepEqual(posted, []);
});

test("write access is write, maintain or admin; no access is no; any other failure throws", () => {
  const answers = { admin: true, maintain: true, write: true, triage: false, read: false, none: false };
  for (const [permission, expected] of Object.entries(answers)) {
    assert.equal(canWrite("stigmer/stigmer", "x", () => `${permission}\n`), expected, permission);
  }
  const failing = (text) => () => {
    const error = new Error("Command failed");
    error.stderr = text;
    throw error;
  };
  assert.equal(canWrite("stigmer/stigmer", "x", failing("gh: Not Found (HTTP 404)")), false);
  assert.equal(canWrite("stigmer/stigmer", "dependabot[bot]", failing("gh: dependabot[bot] is not a user (HTTP 404)")), false);
  assert.throws(() => canWrite("stigmer/stigmer", "x", failing("gh: Server Error (HTTP 502)")), /cannot read x's permission on stigmer\/stigmer: gh: Server Error \(HTTP 502\)$/);
});

function fakeGh(answers) {
  const calls = [];
  const api = (args) => {
    calls.push(args.slice(0, 2).join(" "));
    const answer = answers[args.slice(0, 2).join(" ")];
    if (answer instanceof Error) throw answer;
    return answer ?? "";
  };
  return { api, calls };
}

test("a posted verdict reruns the head's newest check run once it has finished", () => {
  const done = fakeGh({ "run list": JSON.stringify([{ databaseId: 42, status: "completed" }]) });
  assert.match(rejudge("stigmer/stigmer", HEAD, done.api), /reran ci\.review\.yaml run 42/);
  assert.deepEqual(done.calls, ["run list", "run rerun"]);
  const running = fakeGh({ "run list": JSON.stringify([{ databaseId: 43, status: "in_progress" }]) });
  rejudge("stigmer/stigmer", HEAD, running.api);
  assert.deepEqual(running.calls, ["run list", "run watch", "run rerun"]);
  const failedWatch = fakeGh({ "run list": JSON.stringify([{ databaseId: 44, status: "queued" }]), "run watch": new Error("run failed") });
  rejudge("stigmer/stigmer", HEAD, failedWatch.api);
  assert.deepEqual(failedWatch.calls, ["run list", "run watch", "run rerun"], "a failed run is still finished, and is rerun");
});

test("a head with no check run, or a repository without the workflow, is said so, not rerun", () => {
  const none = fakeGh({ "run list": "[]" });
  assert.match(rejudge("stigmer/stigmer", HEAD, none.api), /no ci\.review\.yaml run exists for aaaaaaaaaa.*conflicts with its base.*Merge main into the branch and push/);
  assert.deepEqual(none.calls, ["run list"]);
  const missing = new Error("Command failed");
  missing.stderr = "could not find any workflows named ci.review.yaml";
  const noWorkflow = fakeGh({ "run list": missing });
  assert.match(rejudge("other-org/other-repo", HEAD, noWorkflow.api), /has no ci\.review\.yaml; nothing to rerun/);
  const other = new Error("Command failed");
  other.stderr = "HTTP 502";
  assert.throws(() => rejudge("stigmer/stigmer", HEAD, fakeGh({ "run list": other }).api));
});

test("a remote URL names its repository in every form git writes", () => {
  for (const url of [
    "https://github.com/stigmer/stigmer.git",
    "https://github.com/stigmer/stigmer",
    "https://x-access-token:abc@github.com/stigmer/stigmer.git",
    "git@github.com:stigmer/stigmer.git",
    "ssh://git@github.com/stigmer/stigmer.git",
    "https://github.com/stigmer/stigmer/\n",
  ]) {
    assert.equal(repoFromUrl(url), "stigmer/stigmer", url);
  }
  assert.equal(repoFromUrl("git@github.com:other-org/other-repo.git"), "other-org/other-repo");
  assert.equal(repoFromUrl("not a url"), undefined);
  assert.equal(repoFromUrl(undefined), undefined);
});

test("the diff is computed only in a checkout of the pull request's repository", () => {
  const { root, work } = repositories();
  try {
    git(work, "remote", "set-url", "origin", "git@github.com:stigmer/stigmer.git");
    assert.equal(checkoutFor("stigmer/stigmer", work), git(work, "rev-parse", "--show-toplevel"));
    assert.equal(checkoutFor("Stigmer/Stigmer", work), git(work, "rev-parse", "--show-toplevel"), "GitHub names are case-insensitive");
    assert.throws(() => checkoutFor("other-org/other-repo", work), /is a checkout of stigmer\/stigmer, not other-org\/other-repo; pass --dir/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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

test("a whitespace-only edit to the change moves the change id", () => {
  const { root, work, lines } = repositories();
  try {
    git(work, "switch", "--quiet", "-c", "topic");
    const changed = [...lines];
    changed[30] = "rm -rf /tmp/y";
    writeFileSync(join(work, "file.txt"), `${changed.join("\n")}\n`);
    git(work, "commit", "--quiet", "-am", "the change");
    const first = changeId(work, { head: git(work, "rev-parse", "HEAD"), base: "main" });
    changed[30] = "rm -rf / tmp/y";
    writeFileSync(join(work, "file.txt"), `${changed.join("\n")}\n`);
    git(work, "commit", "--quiet", "-am", "one space, another meaning");
    assert.notEqual(changeId(work, { head: git(work, "rev-parse", "HEAD"), base: "main" }), first);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a user's diff settings do not move the change id", () => {
  const { root, work, lines } = repositories();
  try {
    git(work, "switch", "--quiet", "-c", "topic");
    const changed = [...lines];
    changed[10] = "line 11, changed";
    changed[25] = "line 26, changed";
    writeFileSync(join(work, "file.txt"), `${changed.join("\n")}\n`);
    git(work, "commit", "--quiet", "-am", "two hunks");
    const head = git(work, "rev-parse", "HEAD");
    const plain = changeId(work, { head, base: "main" });
    for (const [key, value] of [
      ["diff.context", "10"],
      ["diff.interHunkContext", "20"],
      ["diff.indentHeuristic", "false"],
      ["diff.noprefix", "true"],
      ["diff.mnemonicPrefix", "true"],
      ["diff.suppressBlankEmpty", "true"],
      ["diff.algorithm", "histogram"],
      ["diff.renames", "copies"],
      ["diff.x.algorithm", "histogram"],
    ]) {
      git(work, "config", key, value);
      assert.equal(changeId(work, { head, base: "main" }), plain, `${key}=${value}`);
    }
    // Attributes live in files no -c reaches; --text sets them aside.
    for (const attributes of ["*.txt -diff", "*.txt binary", "*.txt diff=x"]) {
      writeFileSync(join(work, ".git", "info", "attributes"), `${attributes}\n`);
      assert.equal(changeId(work, { head, base: "main" }), plain, attributes);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("two changes that differ only in bytes that are not UTF-8 have different change ids", () => {
  const ids = [];
  for (const bytes of [[0x80, 0x81], [0xfe, 0xff]]) {
    const { root, work } = repositories();
    try {
      git(work, "switch", "--quiet", "-c", "topic");
      writeFileSync(join(work, "data.bin"), Buffer.from([0x61, ...bytes, 0x0a]));
      git(work, "add", "data.bin");
      git(work, "commit", "--quiet", "-m", "bytes");
      ids.push(changeId(work, { head: git(work, "rev-parse", "HEAD"), base: "main" }));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
  assert.notEqual(ids[0], ids[1]);
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
