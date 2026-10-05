/** Exercise the artwork generator in isolation so invalid source never produces upload assets. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  cp,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";
import sharp from "sharp";

const run = promisify(execFile);
const root = fileURLToPath(new URL("../../", import.meta.url));
const source = await readFile(join(root, "brand/logo.svg"), "utf8");

async function fixture(
  svg: string,
  check: (directory: string) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), "stigmer-brand-generator-"));
  try {
    await mkdir(join(directory, "brand"));
    for (const file of ["generate.ts", "assets.mts", "package.json"]) {
      await cp(join(root, "brand", file), join(directory, "brand", file));
    }
    await cp(join(root, "brand/source"), join(directory, "brand/source"), {
      recursive: true,
    });
    await symlink(
      join(root, "node_modules"),
      join(directory, "node_modules"),
      "dir",
    );
    await writeFile(join(directory, "brand/logo.svg"), svg);
    await check(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const generate = (directory: string) =>
  run(
    process.execPath,
    [
      join(root, "node_modules/tsx/dist/cli.mjs"),
      join(directory, "brand/generate.ts"),
    ],
    {
      cwd: directory,
      timeout: 30_000,
      env: {
        ...process.env,
        TSX_TSCONFIG_PATH: join(root, "marketing/tsconfig.json"),
      },
    },
  );

test("the generator exports current upload pixels and identical runtime paths", async () => {
  await fixture(source, async (directory) => {
    await generate(directory);
    const geometry = await readFile(
      join(directory, "brand/geometry.ts"),
      "utf8",
    );
    const paths = JSON.parse(
      geometry.match(/MARK_PATHS = ([\s\S]+) as const;/)![1],
    );
    assert.deepEqual(
      paths,
      [...source.matchAll(/<path d="([^"]+)"\/>/g)].map((match) => match[1]),
    );
    const actual = await sharp(join(directory, "brand/logo.png"))
      .raw()
      .toBuffer();
    const expected = await sharp(Buffer.from(source)).raw().toBuffer();
    assert.deepEqual(actual, expected);
    assert.equal(
      await readFile(join(directory, "brand/logo-white.svg"), "utf8"),
      await readFile(join(directory, "site/public/logo-white.svg"), "utf8"),
    );
  });
});

test("horizontal exports preserve the symbol, include outlined lettering, and match the site copy", async () => {
  await fixture(source, async (directory) => {
    await generate(directory);
    const dark = await readFile(join(directory, "brand/logo-lockup.svg"));
    const light = await readFile(
      join(directory, "brand/logo-lockup-white.svg"),
    );
    assert.doesNotMatch(
      dark.toString(),
      /<text\b|<image\b|font-family|https?:\/\/(?!www\.w3\.org)/,
    );
    const rendered = sharp(dark).resize(364, 96);
    const symbol = await rendered
      .clone()
      .extract({ left: 0, top: 0, width: 96, height: 96 })
      .ensureAlpha()
      .raw()
      .toBuffer();
    const expected = await sharp(Buffer.from(source))
      .resize(96, 96)
      .ensureAlpha()
      .raw()
      .toBuffer();
    assert.deepEqual(
      symbol,
      expected,
      "the horizontal layout must not redraw the symbol",
    );
    const lettering = await rendered
      .clone()
      .extract({ left: 104, top: 0, width: 260, height: 96 })
      .ensureAlpha()
      .raw()
      .toBuffer();
    assert.ok(
      lettering.some((value, index) => index % 4 === 3 && value > 0),
      "the name must remain visible without a font download",
    );
    assert.deepEqual(
      await sharp(dark).extractChannel("alpha").raw().toBuffer(),
      await sharp(light).extractChannel("alpha").raw().toBuffer(),
    );
    assert.deepEqual(
      light,
      await readFile(join(directory, "site/public/logo-lockup-white.svg")),
    );
    for (const suffix of ["", "-white"]) {
      const metadata = await sharp(
        join(directory, `brand/logo-lockup${suffix}.png`),
      ).metadata();
      assert.equal(metadata.width, 1536);
      assert.equal(metadata.height, 405);
      assert.equal(metadata.hasAlpha, true);
    }
  });
});

for (const [name, invalid] of [
  ["missing form", source.replace(/<path d="[^"]+"\/>/, "")],
  [
    "old mask",
    source.replace("</title>", '</title><defs><mask id="old"/></defs>'),
  ],
  ["reinforcing stroke", source.replace("<g fill=", '<g stroke="#000" fill=')],
]) {
  test(`the generator rejects a ${name} before writing derived files`, async () => {
    await fixture(invalid, async (directory) => {
      await assert.rejects(generate(directory), (error: unknown) => {
        assert.ok(
          error instanceof Error && "code" in error && "stderr" in error,
        );
        assert.equal(error.code, 1);
        assert.match(
          String(error.stderr),
          /eight filled outlines with no masks or reinforcing strokes/,
        );
        return true;
      });
      assert.deepEqual((await readdir(join(directory, "brand"))).sort(), [
        "assets.mts",
        "generate.ts",
        "logo.svg",
        "package.json",
        "source",
      ]);
    });
  });
}
