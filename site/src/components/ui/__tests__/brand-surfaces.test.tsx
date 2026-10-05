/** Keep navigation and reusable branding pointed at a shipped, canonical logo asset. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Header } from "../../layout/Header";
import { Footer } from "../../layout/Footer";
import { Logo } from "../logo";

describe("website brand surfaces", () => {
  it.each([Header, Footer, Logo])("renders a shipped white logo in %s", async (Component) => {
    const markup = renderToStaticMarkup(createElement(Component));
    expect(markup).toContain('src="/logo-white.svg"');
    const directory = dirname(fileURLToPath(import.meta.url));
    const shipped = await readFile(resolve(directory, "../../../../public/logo-white.svg"), "utf8");
    const canonical = await readFile(resolve(directory, "../../../../../brand/logo-white.svg"), "utf8");
    expect(shipped).toBe(canonical);
  });
});
