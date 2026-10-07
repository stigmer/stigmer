/** Pin the canonical silhouette and keep repeated logo instances independent. */
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StigmerLogo } from "../StigmerLogo";

describe("refined brand mark", () => {
  it("renders repeated logos without shared SVG definitions", () => {
    const markup = renderToStaticMarkup(
      createElement(
        "div",
        null,
        createElement(StigmerLogo),
        createElement(StigmerLogo),
      ),
    );
    expect(markup.match(/<svg\b/g)).toHaveLength(2);
    expect(markup.match(/<path\b/g)).toHaveLength(2);
    expect(markup).not.toMatch(/<(?:defs|mask)\b|url\(#/);
  });

  it("renders the same alpha silhouette as the approved vector asset", async () => {
    const markup = renderToStaticMarkup(createElement(StigmerLogo));
    const svg = markup.match(/<svg[\s\S]*?<\/svg>/)?.[0];
    expect(svg).toBeDefined();
    const normalized = svg!.replace(
      /width="\d+" height="\d+"/,
      'width="128" height="128"',
    );
    const source = (
      await readFile(
        resolve(
          dirname(fileURLToPath(import.meta.url)),
          "../../../../../brand/logo.svg",
        ),
        "utf8",
      )
    ).replace(/width="1024" height="1024"/, 'width="128" height="128"');
    const actual = await sharp(Buffer.from(normalized))
      .extractChannel("alpha")
      .raw()
      .toBuffer();
    const expected = await sharp(Buffer.from(source))
      .extractChannel("alpha")
      .raw()
      .toBuffer();
    expect(actual).toEqual(expected);
  });
});
