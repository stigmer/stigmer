/** Verify usable upload files and consistent platform exports from the canonical artwork. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import sharp from "sharp";
import {
  BRAND_DARK,
  BRAND_LIGHT,
  SHADED_FACES,
  SHADED_TONES,
  type ShadedFace,
  brandLockupSvg,
  brandShadedSvg,
  brandSvg,
} from "../assets.mjs";

const flatSource = await readFile(
  new URL("../logo.svg", import.meta.url),
  "utf8",
);
const shadedSource = await readFile(
  new URL("../source/shaded.svg", import.meta.url),
  "utf8",
);

async function alphaOf(svg: string, size = 512): Promise<Buffer> {
  return sharp(Buffer.from(svg))
    .resize(size, size)
    .ensureAlpha()
    .extractChannel("alpha")
    .raw()
    .toBuffer();
}

/**
 * Count pixels whose coverage differs by more than antialiasing can explain. Where a
 * face's underlap meets the outer edge a few pixels draw twice, so a handful is allowed;
 * an outline that drifts from brand/logo.svg differs by hundreds.
 */
const JOINT_PIXELS = 16;
function mismatches(actual: Buffer, expected: Buffer): number {
  let count = 0;
  for (let i = 0; i < actual.length; i++)
    if (Math.abs(actual[i] - expected[i]) > 32) count++;
  return count;
}

test("the source artwork is drawn in BRAND_DARK, so every recolor takes effect", async () => {
  for (const file of ["../logo.svg", "../source/wordmark.svg"]) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.ok(
      source.includes(`fill="${BRAND_DARK}"`),
      `${file} must use BRAND_DARK, the color the generators replace`,
    );
  }
  const light = await brandLockupSvg({ color: BRAND_LIGHT });
  assert.ok(
    !light.includes(BRAND_DARK),
    "a light lockup must keep no dark fill in the mark or the lettering",
  );
});

test("the shaded ring and bars cover exactly the flat mark", async () => {
  const ringAndBars = shadedSource.replace(
    /<path data-face="inner-[a-z]+"[^>]*\/>/g,
    "",
  );
  assert.ok(
    mismatches(await alphaOf(ringAndBars), await alphaOf(flatSource)) <=
      JOINT_PIXELS,
    "brand/source/shaded.svg must follow the outline of brand/logo.svg",
  );
});

test("the shaded mark fills the whole hexagon with no seam between faces", async () => {
  const hexagon = flatSource.replace(/Z[^"]*"/, 'Z"');
  for (const on of ["dark", "light"] as const) {
    const actual = await alphaOf(
      await brandShadedSvg({ on, size: 1024 }),
      1024,
    );
    const expected = await alphaOf(hexagon, 1024);
    assert.ok(mismatches(actual, expected) <= JOINT_PIXELS * 2);
    const leak = actual.findIndex(
      (value, i) => expected[i] === 255 && value < 250,
    );
    assert.equal(
      leak,
      -1,
      `the background shows through a face join at pixel ${leak}`,
    );
  }
});

test("each lighting gives every face a tone and leaves no source tone behind", async () => {
  for (const on of ["dark", "light"] as const) {
    const svg = await brandShadedSvg({ on });
    const faces = [
      ...svg.matchAll(/data-face="([a-z-]+)" fill="(#[0-9a-f]{6})"/g),
    ];
    assert.deepEqual(
      faces.map((match) => match[1]),
      [...SHADED_FACES],
    );
    assert.ok(
      faces.every(
        ([, face, fill]) => fill === SHADED_TONES[on][face as ShadedFace],
      ),
    );
  }
});

for (const size of [16, 24, 32, 1024]) {
  test(`transparent light and dark marks have identical silhouettes at ${size}px`, async () => {
    const light = sharp(Buffer.from(await brandSvg({ size })));
    const dark = sharp(
      Buffer.from(await brandSvg({ size, color: BRAND_LIGHT })),
    );
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
    await readFile(new URL("../avatar.png", import.meta.url)),
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
    background: BRAND_LIGHT,
    tight: true,
  });
  const rounded = await brandSvg({
    size: 180,
    background: BRAND_DARK,
    color: BRAND_LIGHT,
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
            color: theme === "dark" ? BRAND_LIGHT : BRAND_DARK,
            background: theme === "dark" ? BRAND_DARK : BRAND_LIGHT,
          }),
        ),
      )
        .raw()
        .toBuffer();
      const actual = await sharp(
        await readFile(
          new URL(
            `../../client-apps/web/public/favicon-${theme}-${size}x${size}.png`,
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

for (const [filename, render] of [
  ["logo.png", () => brandSvg({ color: BRAND_DARK })],
  ["logo-white.png", () => brandSvg({ color: BRAND_LIGHT })],
  ["logo-shaded.png", () => brandShadedSvg({ on: "light" })],
  ["logo-shaded-white.png", () => brandShadedSvg({ on: "dark" })],
  ["avatar.png", () => brandShadedSvg({ on: "dark", background: BRAND_DARK })],
] as const) {
  test(`${filename} contains the current canonical artwork`, async () => {
    const expected = await sharp(Buffer.from(await render()))
      .ensureAlpha()
      .raw()
      .toBuffer();
    const actual = await sharp(
      await readFile(new URL(`../${filename}`, import.meta.url)),
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
