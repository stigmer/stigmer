/** Verify usable upload files and consistent platform exports from the canonical artwork. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import sharp from "sharp";
import { brandSvg } from "./assets.mjs";

for (const size of [16, 24, 32, 1024]) {
  test(`transparent light and dark marks have identical silhouettes at ${size}px`, async () => {
    const light = sharp(Buffer.from(await brandSvg({ size })));
    const dark = sharp(Buffer.from(await brandSvg({ size, color: "#fefefe" })));
    const metadata = await light.metadata();
    assert.equal(metadata.width, size);
    assert.equal(metadata.height, size);
    const alpha = await light.extractChannel("alpha").raw().toBuffer();
    assert.deepEqual(
      alpha,
      await dark.extractChannel("alpha").raw().toBuffer(),
    );
    assert.equal(
      alpha[0],
      0,
      "the mark must remain transparent outside its shape",
    );
    assert.ok(alpha.includes(255), "the mark must have opaque ink");
  });
}

test("the default avatar is opaque, square and safe for a circular crop", async () => {
  const avatar = sharp(
    await readFile(new URL("./avatar.png", import.meta.url)),
  );
  const { data, info } = await avatar
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 1024);
  assert.equal(info.height, 1024);
  let ink = 0;
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 4;
      assert.equal(
        data[i + 3],
        255,
        "avatar services must not choose the background",
      );
      if (data[i] > 128) {
        ink++;
        assert.ok(
          Math.hypot(x - 511.5, y - 511.5) < 512,
          "circular cropping must not clip the mark",
        );
      }
    }
  assert.ok(ink > 100000, "the avatar must contain visible artwork");
});

test("favicon crops and rounded app backgrounds render at native target resolution", async () => {
  const tight = await brandSvg({
    size: 16,
    background: "#f1f1f1",
    tight: true,
  });
  const rounded = await brandSvg({
    size: 180,
    background: "#0a0a0a",
    color: "#fefefe",
    rounded: true,
  });
  const squareAlpha = await sharp(Buffer.from(tight))
    .extractChannel("alpha")
    .raw()
    .toBuffer();
  assert.ok(
    squareAlpha.every((value) => value === 255),
    "favicon background must fill the slot",
  );
  const roundedAlpha = await sharp(Buffer.from(rounded))
    .extractChannel("alpha")
    .raw()
    .toBuffer();
  assert.equal(
    roundedAlpha[0],
    0,
    "rounded app icon corners must be transparent",
  );
});

for (const theme of ["light", "dark"]) {
  test(`${theme} web favicon pixels match the canonical mark at both shipped sizes`, async () => {
    for (const size of [16, 32]) {
      const expected = await sharp(
        Buffer.from(
          await brandSvg({
            size,
            tight: true,
            color: theme === "dark" ? "#fefefe" : "#0a0a0a",
            background: theme === "dark" ? "#0a0a0a" : "#f1f1f1",
          }),
        ),
      )
        .raw()
        .toBuffer();
      const actual = await sharp(
        await readFile(
          new URL(
            `../client-apps/web/public/favicon-${theme}-${size}x${size}.png`,
            import.meta.url,
          ),
        ),
      )
        .raw()
        .toBuffer();
      assert.deepEqual(
        actual,
        expected,
        "regenerate the web icons after changing the brand source",
      );
    }
  });
}

for (const [filename, color, background] of [
  ["logo.png", "#0a0a0a", undefined],
  ["logo-white.png", "#fefefe", undefined],
  ["avatar.png", "#fefefe", "#0a0a0a"],
] as const) {
  test(`${filename} contains the current canonical artwork`, async () => {
    const expected = await sharp(
      Buffer.from(await brandSvg({ color, background })),
    )
      .ensureAlpha()
      .raw()
      .toBuffer();
    const actual = await sharp(
      await readFile(new URL(`./${filename}`, import.meta.url)),
    )
      .ensureAlpha()
      .raw()
      .toBuffer();
    assert.deepEqual(
      actual,
      expected,
      "run npm run generate:brand to refresh upload images",
    );
  });
}
