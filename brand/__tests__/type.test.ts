/**
 * Pin the brand's type to its files: every face brand/type.ts names is on
 * disk in brand/fonts/ beside its licence, and the Geist pair is the
 * console's, byte for byte, so the site's words and the product screens it
 * shows are drawn from one font file each. A Geist update made in one place
 * fails here until it is made in both. The social card reads each of its
 * faces at the file's default instance, so each file's own weight is read
 * here: a cut or a default that moved would change the card's letters.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as fontkit from "fontkit";
import { CARD_TYPE, TYPE } from "../type";

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
  const named = new Set([
    ...Object.values(TYPE).flatMap((face) => [face.file, face.licence]),
    ...Object.values(CARD_TYPE).map((face) => face.file),
  ]);
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

test("each face the card draws from is its weight at the file's default instance", () => {
  for (const [part, face] of Object.entries(CARD_TYPE)) {
    const font = fontkit.create(readFileSync(FONTS + face.file));
    assert.ok("familyName" in font, `${face.file} is a single font`);
    assert.equal(font.familyName, face.family, part);
    const axis = font.variationAxes.wght;
    assert.equal(axis ? axis.default : font["OS/2"].usWeightClass, face.weight, part);
  }
});
