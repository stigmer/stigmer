/**
 * The site's root metadata and its web manifest: what search results, link
 * previews, an installed home-screen icon and a browser tab say Stigmer is.
 *
 * Pins that each of them reads the headline and the one sentence from
 * brand/positioning.ts through SITE_CONFIG, that the manifest is the
 * metadata route (no static file is linked by hand), and that the manifest's
 * colors are the dark site's own.
 */
import { describe, expect, it, vi } from "vitest";
import { POSITIONING } from "../../../../brand/positioning";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "" });
  return { Instrument_Sans: font, Instrument_Serif: font, DM_Mono: font };
});

describe("the site's root metadata", () => {
  it("titles and describes every page with the headline and the one sentence", async () => {
    const { metadata } = await import("../layout");
    const title = `Stigmer — ${POSITIONING.headline}`;

    expect(metadata.title).toEqual({ default: title, template: "%s | Stigmer" });
    expect(metadata.description).toBe(POSITIONING.oneSentence);
    expect(metadata.openGraph?.title).toBe(title);
    expect(metadata.openGraph?.description).toBe(POSITIONING.oneSentence);
    expect(metadata.twitter?.title).toBe(title);
    expect(metadata.twitter?.description).toBe(POSITIONING.oneSentence);
    expect(metadata.keywords).toBeUndefined();
    expect(metadata.manifest).toBeUndefined();
  });
});

describe("the web manifest", () => {
  it("describes Stigmer in the one sentence, in the site's own colors", async () => {
    const { default: manifest } = await import("../manifest");
    const { viewport } = await import("../layout");

    expect(manifest().name).toBe(POSITIONING.name);
    expect(manifest().description).toBe(POSITIONING.oneSentence);
    expect(manifest().theme_color).toBe(viewport.themeColor);
    expect(manifest().background_color).toBe(viewport.themeColor);
  });
});
