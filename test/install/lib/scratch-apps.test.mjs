// Holds the scratch apps (lib/scratch-apps.mjs). Ledgerly moved out of the
// coding-agent door so the app walk could use it too; the door proves the
// console's prompt on it, so the move must leave it the same app: these
// files, this sign-in, this session read. Statements is held to what the
// app walk's checks rely on: its stand-in sign-in, the session's user id,
// an upload route, and an env file git ignores.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { ledgerlyFiles, statementsFiles, writeLedgerly, writeStatements } from "./scratch-apps.mjs";

test("Ledgerly is the door's app: the same files, its sign-in and its session read", () => {
  assert.deepEqual(Object.keys(ledgerlyFiles()), [
    "package.json",
    "README.md",
    ".gitignore",
    "tsconfig.json",
    "lib/session.ts",
    "app/layout.tsx",
    "app/page.tsx",
    "app/invoices/page.tsx",
    "app/login/route.ts",
  ]);
  const files = ledgerlyFiles();
  assert.equal(JSON.parse(files["package.json"]).name, "ledgerly");
  assert.match(files["lib/session.ts"], /export async function getSession\(\)/);
  assert.match(files["lib/session.ts"], /userId: `user-\$\{value\}`/);
  assert.match(files["app/login/route.ts"], /cookies\.set\("ledgerly_user", user\)/);
  assert.match(files[".gitignore"], /^\.env\*\.local$/m);
});

test("Ledgerly takes the walk's registry in its own .npmrc only when given one", () => {
  assert.equal(ledgerlyFiles()[".npmrc"], undefined);
  assert.equal(ledgerlyFiles("@stigmer:registry=https://r.example/\n")[".npmrc"], "@stigmer:registry=https://r.example/\n");
});

test("Statements signs a customer in, names them user-<name>, takes an upload, and ignores .env", () => {
  const files = statementsFiles();
  assert.match(files["app/main.py"], /@app\.get\("\/login"\)/);
  assert.match(files["app/main.py"], /@app\.post\("\/statements"/);
  assert.match(files["app/session.py"], /User\(id=f"user-\{name\}"/);
  assert.match(files[".gitignore"], /^\.env$/m);
  assert.match(files["requirements.txt"], /^python-dotenv$/m);
  assert.match(files["README.md"], /uvicorn app\.main:app --env-file \.env/);
});

test("each writer commits its app to a fresh repository", () => {
  for (const write of [writeLedgerly, writeStatements]) {
    const dir = mkdtempSync(join(tmpdir(), "scratch-apps-"));
    try {
      write(dir);
      assert.equal(execFileSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8" }), "");
      assert.equal(execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: dir, encoding: "utf8" }).trim(), "1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});
