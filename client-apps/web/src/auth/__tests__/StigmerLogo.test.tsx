/** Keep the public-page avatar theme-independent and identical to the approved upload image. */
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StigmerLogo } from "../StigmerLogo";

describe("shaded public-page branding", () => {
  it("uses the shipped shaded avatar in either theme", async () => {
    const markup = renderToStaticMarkup(createElement(StigmerLogo));
    expect(markup).toContain('src="/brand-avatar.png"');
    expect(markup).toContain('alt="Stigmer"');
    const directory = dirname(fileURLToPath(import.meta.url));
    expect(await readFile(resolve(directory, "../../../public/brand-avatar.png"))).toEqual(
      await readFile(resolve(directory, "../../../../../brand/avatar.png")),
    );
  });
});
