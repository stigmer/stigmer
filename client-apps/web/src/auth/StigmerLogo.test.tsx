/** Pin the refined silhouette and prevent SVG mask collisions between mounted logo instances. */
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StigmerLogo } from "./StigmerLogo";

describe("refined brand mark", () => {
  it("uses an independent mask for each mounted logo", () => {
    const markup = renderToStaticMarkup(
      createElement(
        "div",
        null,
        createElement(StigmerLogo),
        createElement(StigmerLogo),
      ),
    );
    const ids = [...markup.matchAll(/<mask id="([^"]+)"/g)].map(
      (match) => match[1],
    );
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) expect(markup).toContain(`url(#${id})`);
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
          "../../../../brand/logo.svg",
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
