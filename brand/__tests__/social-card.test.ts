/**
 * Pin what each social card says and how it is drawn: only the words it is
 * given and the badges, escaped for XML, at its layout's exact size, around
 * the unmodified shaded mark, every word an outline from the brand's faces
 * and none of it text, so no machine's fonts can change what it shows.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import * as fontkit from "fontkit";
import sharp from "sharp";
import { brandShadedSvg } from "../assets.mjs";
import { POSITIONING } from "../positioning";
import {
  SOCIAL_CARD_BADGES,
  SOCIAL_CARDS,
  type SocialCardLayout,
  socialCardSvg,
} from "../social-card";

/** The words each outlined line carries, in drawing order. */
const texts = (svg: string) =>
  [...svg.matchAll(/<path aria-label="([^"]*)"/g)].map((match) => match[1]);

const draw = (layout: SocialCardLayout, words = POSITIONING) =>
  socialCardSvg(layout, words, fontkit);

for (const [name, layout] of Object.entries<SocialCardLayout>(SOCIAL_CARDS)) {
  test(`the ${name} card says the headline and the one sentence, and nothing else but its badges`, async () => {
    const svg = await draw(layout);
    assert.deepEqual(texts(svg), [
      POSITIONING.headline,
      POSITIONING.oneSentence,
      ...(layout.badges ? SOCIAL_CARD_BADGES : []),
    ]);
  });

  test(`the ${name} card draws its words as outlines, with no text for a machine's fonts to set`, async () => {
    const svg = await draw(layout);
    assert.doesNotMatch(svg, /<text\b|font-family/);
    assert.ok(
      svg.includes(`<title>${POSITIONING.headline} ${POSITIONING.oneSentence}</title>`),
      "the card's title carries its words",
    );
    for (const outline of svg.matchAll(/<path aria-label="[^"]*" fill="[^"]*" d="([^"]*)"/g)) {
      assert.match(outline[1], /^M[\d.-]/, "every line has an outline");
    }
  });

  test(`the ${name} card rasterises to ${layout.width} × ${layout.height}`, async () => {
    const metadata = await sharp(
      Buffer.from(await draw(layout)),
    ).metadata();
    assert.deepEqual(
      [metadata.width, metadata.height],
      [layout.width, layout.height],
    );
  });

  const { mark } = layout;
  if (mark) {
    test(`the ${name} card nests the shaded mark unmodified, centred on the text`, async () => {
      const svg = await draw(layout);
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
  const svg = await draw(SOCIAL_CARDS.linkedinCompanyCover);
  assert.doesNotMatch(svg, /data-face=/);
  assert.equal(texts(svg).length, 2);
});

test("the words are escaped, so any headline still draws", async () => {
  const svg = await draw(SOCIAL_CARDS.openGraph, {
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
