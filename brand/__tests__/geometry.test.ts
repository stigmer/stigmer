/** Keep the enclosure hollow and the three fins separated in the rendered brand artwork. */
import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { brandSvg } from "../assets.mjs";

test("the enclosure retains a transparent interior and three distinct fins", async () => {
  const size = 340;
  const alpha = await sharp(Buffer.from(await brandSvg({ size })))
    .extractChannel("alpha")
    .raw()
    .toBuffer();
  const at = (x: number, y: number) =>
    alpha[Math.round(y * 10) * size + Math.round(x * 10)];
  assert.equal(at(17, 14), 0, "the inner cube must remain negative space");
  for (const [x, y] of [
    [17, 6],
    [7, 17],
    [27, 17],
    [17, 28],
  ]) {
    assert.equal(at(x, y), 255, "the enclosure must be solid on every side");
  }
  let fins = 0;
  let inside = false;
  for (let x = 150; x < 241; x++) {
    const filled = alpha[210 * size + x] > 128;
    if (filled && !inside) fins++;
    inside = filled;
  }
  assert.equal(
    fins,
    3,
    "the fins must remain three separate bands before joining the wall",
  );
});
