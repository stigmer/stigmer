/**
 * Pin the brand's type to its files: every face brand/type.ts names is on
 * disk in brand/fonts/ beside its licence, and the Geist pair is the
 * console's, byte for byte, so the site's words and the product screens it
 * shows are drawn from one font file each. A Geist update made in one place
 * fails here until it is made in both.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { TYPE } from "../type";

const FONTS = fileURLToPath(new URL("../fonts/", import.meta.url));
const CONSOLE_FONTS = fileURLToPath(
  new URL("../../client-apps/web/src/app/fonts/", import.meta.url),
);
const sha256 = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

test("every face the brand names ships in brand/fonts with its licence", () => {
  for (const [role, face] of Object.entries(TYPE)) {
    assert.ok(existsSync(FONTS + face.file), `${role}: ${face.file}`);
    assert.ok(existsSync(FONTS + face.licence), `${role}: ${face.licence}`);
    assert.match(
      readFileSync(FONTS + face.licence, "utf8"),
      /SIL Open Font License, Version 1\.1/,
    );
  }
});

test("brand/fonts holds the named faces, their licences and the provenance, nothing else", () => {
  const named = new Set(
    Object.values(TYPE).flatMap((face) => [face.file, face.licence]),
  );
  assert.deepEqual(
    readdirSync(FONTS).sort(),
    [...named, "README.md"].sort(),
  );
});

test("the Geist pair is the console's, byte for byte", () => {
  for (const face of [TYPE.sans, TYPE.mono]) {
    assert.equal(
      sha256(FONTS + face.file),
      sha256(CONSOLE_FONTS + face.file),
      `${face.file} differs from client-apps/web/src/app/fonts/${face.file}`,
    );
  }
  assert.equal(
    readFileSync(FONTS + TYPE.sans.licence, "utf8"),
    readFileSync(CONSOLE_FONTS + TYPE.sans.licence, "utf8"),
  );
});
