// Pins pty-run.py, the install smokes' pseudo-terminal driver: the command
// sees a TTY on stdin and stdout, an answer is typed when its text appears,
// the command's exit code passes through (128 + N for a signal), named keys
// arrive one write each and a paste bracketed, a resize reaches the command,
// and a timeout or an answer whose text never appeared exits 124 or 125.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const DRIVER = fileURLToPath(new URL("./pty-run.py", import.meta.url));

function drive(driverArgs, script) {
  return spawnSync("python3", [DRIVER, ...driverArgs, "--", process.execPath, "-e", script], { encoding: "utf8", timeout: 60_000 });
}

test("the command sees a terminal on stdin and stdout", () => {
  const result = drive([], "process.stdout.write(`tty:${process.stdin.isTTY}:${process.stdout.isTTY}`)");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /tty:true:true/);
});

test("an answer is typed when its text appears, and the exit code passes through", () => {
  const script = [
    "process.stdin.setRawMode(true);",
    "process.stdout.write('\\x1b[33mProceed?\\x1b[0m ');",
    "process.stdin.once('data', (key) => { process.stdout.write(`got:${key}`); process.exit(7); });",
  ].join("");
  const result = drive(["--answer", "Proceed?=y"], script);
  assert.equal(result.status, 7, result.stderr);
  assert.match(result.stdout, /Proceed\? got:y/);
});

test("Ctrl+C typed as an escape interrupts the command", () => {
  const script = "process.stdout.write('ready'); setInterval(() => {}, 1000);";
  const result = drive(["--answer", "ready=\\x03"], script);
  assert.equal(result.status, 130, result.stderr);
});

test("a timeout exits 124, and an answer that never shows exits 125", () => {
  assert.equal(drive(["--timeout", "1"], "setInterval(() => {}, 1000);").status, 124);
  const unseen = drive(["--answer", "never=y"], "process.stdout.write('done');");
  assert.equal(unseen.status, 125);
  assert.match(unseen.stderr, /never saw 'never'/);
});

test("named keys arrive one write each, and a paste arrives bracketed", () => {
  const script = [
    "process.stdin.setRawMode(true);",
    "const got = [];",
    "process.stdout.write('ready ');",
    "process.stdin.on('data', (key) => { got.push(JSON.stringify(String(key))); if (got.length === 5) { process.stdout.write(`got:${got.join(',')}`); process.exit(0); } });",
  ].join("");
  const result = drive(["--answer", "ready=ab<esc><up><paste:x\\ny><ctrl-c>"], script);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /got:"ab","\\u001b","\\u001b\[A","\\u001b\[200~x\\ny\\u001b\[201~","\\u0003"/);
});

test("a resize sets the window and tells the command", () => {
  const script = [
    "process.stdout.write(`size:${process.stdout.columns}x${process.stdout.rows} `);",
    "process.stdout.on('resize', () => { process.stdout.write(`now:${process.stdout.columns}x${process.stdout.rows}`); process.exit(0); });",
    "setTimeout(() => process.exit(9), 20000);",
  ].join("");
  const result = drive(["--cols", "120", "--rows", "40", "--resize", "80x30@size:120x40"], script);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /size:120x40 now:80x30/);
});

test("a malformed answer or resize is refused", () => {
  for (const args of [["--answer", "no-equals"], ["--resize", "80x40"], ["--resize", "wide@text"]]) {
    const result = drive(args, "process.exit(0)");
    assert.equal(result.status, 2, `${args.join(" ")}: ${result.stderr}`);
  }
});
