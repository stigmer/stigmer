/**
 * Pin what each social card says and how it is drawn: only the words it is
 * given and the badges, escaped for XML, at its layout's exact size, around
 * the unmodified shaded mark. Closeness to the uploaded covers depends on the
 * machine's fonts, so it is measured when the images are regenerated, not here.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { brandShadedSvg } from "../assets.mjs";
import { POSITIONING } from "../positioning";
import {
  SOCIAL_CARD_BADGES,
  SOCIAL_CARDS,
  type SocialCardLayout,
  socialCardSvg,
} from "../social-card";

const texts = (svg: string) =>
  [...svg.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)].map((match) => match[1]);

for (const [name, layout] of Object.entries<SocialCardLayout>(SOCIAL_CARDS)) {
  test(`the ${name} card says the headline and the one sentence, and nothing else but its badges`, async () => {
    const svg = await socialCardSvg(layout, POSITIONING);
    assert.deepEqual(texts(svg), [
      POSITIONING.headline,
      POSITIONING.oneSentence,
      ...(layout.badges ? SOCIAL_CARD_BADGES : []),
    ]);
  });

  test(`the ${name} card rasterises to ${layout.width} × ${layout.height}`, async () => {
    const metadata = await sharp(
      Buffer.from(await socialCardSvg(layout, POSITIONING)),
    ).metadata();
    assert.deepEqual(
      [metadata.width, metadata.height],
      [layout.width, layout.height],
    );
  });

  const { mark } = layout;
  if (mark) {
    test(`the ${name} card nests the shaded mark unmodified, centred on the text`, async () => {
      const svg = await socialCardSvg(layout, POSITIONING);
      const shaded = await brandShadedSvg({ size: mark.size, on: "dark" });
      assert.ok(
        svg.includes(
          shaded.replace(
            "<svg ",
            `<svg x="${layout.centerX - mark.size / 2}" y="${mark.top}" `,
          ),
        ),
      );
    });
  }
}

test("the company banner leaves the mark and the badges to the page around it", async () => {
  const svg = await socialCardSvg(
    SOCIAL_CARDS.linkedinCompanyCover,
    POSITIONING,
  );
  assert.doesNotMatch(svg, /data-face=/);
  assert.equal(texts(svg).length, 2);
});

test("the words are escaped, so any headline still draws", async () => {
  const svg = await socialCardSvg(SOCIAL_CARDS.openGraph, {
    headline: "Agents & <tools>",
    oneSentence: "Fast & safe.",
  });
  assert.deepEqual(texts(svg).slice(0, 2), [
    "Agents &amp; &lt;tools&gt;",
    "Fast &amp; safe.",
  ]);
  const metadata = await sharp(Buffer.from(svg)).metadata();
  assert.equal(metadata.width, SOCIAL_CARDS.openGraph.width);
});
