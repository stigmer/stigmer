/** Keep the film's animated mark visually identical to the static brand at full reveal. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import sharp from "sharp";
import { StigmerMark } from "../../marketing/src/films/intro/graphics/StigmerMark.js";
import { brandSvg } from "../assets.mjs";

async function alpha(reveal?: (index: number) => number): Promise<Buffer> {
  const svg = renderToStaticMarkup(
    createElement(StigmerMark, { size: 128, reveal }),
  );
  return sharp(Buffer.from(svg)).extractChannel("alpha").raw().toBuffer();
}

test("the fully revealed film mark matches the static SVG silhouette", async () => {
  const expected = await sharp(Buffer.from(await brandSvg({ size: 128 })))
    .extractChannel("alpha")
    .raw()
    .toBuffer();
  assert.deepEqual(await alpha(), expected);
  assert.deepEqual(await alpha(() => 1), expected);
});

test("a hidden film mark leaves no visible forms or dots", async () => {
  assert.ok((await alpha(() => 0)).every((value) => value === 0));
});

test("partial reveal fades each entire outline evenly", async () => {
  const actual = await alpha(() => 0.5);
  assert.ok(actual.some((value) => value > 0));
  assert.ok(
    actual.every((value) => value <= 128),
    "no region of an outline may appear brighter during its fade",
  );
});
