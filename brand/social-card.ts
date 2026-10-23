/**
 * The social card: Stigmer's headline and one sentence on the dark vignette,
 * drawn for the website's link preview and for the two LinkedIn covers.
 *
 * Each size is a named layout, not one card scaled to fit. LinkedIn lays the
 * profile photo over the cover's lower left and the page logo over the
 * banner's, so each cover places its text by eye around what covers it, and
 * the banner leaves out the mark the page logo already shows. A fitting rule
 * would have to rediscover those numbers; data states them, the way
 * brandLockupSvg states its lettering offset.
 *
 * The card is returned as one SVG, nesting the shaded mark the way the lockup
 * nests the wordmark, and each caller rasterises it with its own sharp: the
 * site's build for og-image.png, brand/generate.ts for the cover uploads. So
 * nothing here decides which sharp, or which libvips, draws an image.
 */
import { brandShadedSvg } from "./assets.mjs";

/** The card's palette: the website hero's monochrome, darker than the mark's graphite. */
const CARD_COLORS = {
  vignetteOuter: "#0a0a0a",
  vignetteInner: "#111111",
  headline: "#f5f5f5",
  muted: "#a3a3a3",
  badgeOutline: "#505050",
} as const;

const SANS =
  "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const MONO = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace";

/** The outline badges under the words, left to right. */
export const SOCIAL_CARD_BADGES = ["Open Source", "Apache 2.0"] as const;

/**
 * The words a card carries; every caller passes brand/positioning.ts's. The
 * one sentence, not the whole subhead: its second sentence does not fit a card
 * at a readable size.
 */
export interface SocialCardWords {
  readonly headline: string;
  readonly oneSentence: string;
}

/** Where one card puts each element, in pixels of its own size. */
export interface SocialCardLayout {
  readonly width: number;
  readonly height: number;
  /** The radial vignette's centre, as percentages of the card. */
  readonly vignette: { readonly cx: string; readonly cy: string };
  /** The x the mark, both lines and the badge row centre on. */
  readonly centerX: number;
  readonly headline: {
    readonly baseline: number;
    readonly size: number;
    readonly tracking: number;
  };
  readonly oneSentence: { readonly baseline: number; readonly size: number };
  readonly mark?: { readonly size: number; readonly top: number };
  readonly badges?: {
    readonly top: number;
    readonly width: number;
    readonly height: number;
    readonly gap: number;
    readonly fontSize: number;
    /** The label's baseline, measured from the badge's top edge. */
    readonly labelBaseline: number;
  };
}

export const SOCIAL_CARDS = {
  /** The website's Open Graph image and the README banner, 1200 × 630. */
  openGraph: {
    width: 1200,
    height: 630,
    vignette: { cx: "50%", cy: "40%" },
    centerX: 600,
    headline: { baseline: 320, size: 48, tracking: -1 },
    oneSentence: { baseline: 390, size: 24 },
    mark: { size: 120, top: 110 },
    badges: {
      top: 480,
      width: 170,
      height: 44,
      gap: 20,
      fontSize: 16,
      labelBaseline: 28,
    },
  },
  /** The founder's LinkedIn cover, 1584 × 396; the profile photo covers about x < 380, y > 200. */
  linkedinCover: {
    width: 1584,
    height: 396,
    vignette: { cx: "50%", cy: "40%" },
    centerX: 792,
    headline: { baseline: 190, size: 60, tracking: -1.2 },
    oneSentence: { baseline: 244, size: 27 },
    mark: { size: 72, top: 52 },
    badges: {
      top: 288,
      width: 170,
      height: 42,
      gap: 20,
      fontSize: 16,
      labelBaseline: 26.76,
    },
  },
  /** The Stigmer LinkedIn page's banner, 1128 × 191; the page logo covers about x < 270, y > 65. */
  linkedinCompanyCover: {
    width: 1128,
    height: 191,
    vignette: { cx: "58%", cy: "45%" },
    centerX: 660,
    headline: { baseline: 92, size: 44, tracking: -0.9 },
    oneSentence: { baseline: 132, size: 20 },
  },
} as const satisfies Record<string, SocialCardLayout>;

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function badgesSvg(
  centerX: number,
  badges: NonNullable<SocialCardLayout["badges"]>,
): string {
  const rowWidth =
    SOCIAL_CARD_BADGES.length * badges.width +
    (SOCIAL_CARD_BADGES.length - 1) * badges.gap;
  return SOCIAL_CARD_BADGES.map((label, index) => {
    const x = centerX - rowWidth / 2 + index * (badges.width + badges.gap);
    return (
      `<rect x="${x}" y="${badges.top}" width="${badges.width}" height="${badges.height}" rx="${badges.height / 2}" fill="none" stroke="${CARD_COLORS.badgeOutline}" stroke-width="1"/>` +
      `<text x="${x + badges.width / 2}" y="${badges.top + badges.labelBaseline}" font-family="${MONO}" font-size="${badges.fontSize}" font-weight="400" fill="${CARD_COLORS.muted}" text-anchor="middle">${label}</text>`
    );
  }).join("");
}

/** Draw one card as a single SVG document, at its layout's pixel size. */
export async function socialCardSvg(
  layout: SocialCardLayout,
  words: SocialCardWords,
): Promise<string> {
  const { width, height, vignette, centerX, headline, oneSentence } = layout;
  const mark = layout.mark
    ? (await brandShadedSvg({ size: layout.mark.size, on: "dark" })).replace(
        "<svg ",
        `<svg x="${centerX - layout.mark.size / 2}" y="${layout.mark.top}" `,
      )
    : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<defs><radialGradient id="vignette" cx="${vignette.cx}" cy="${vignette.cy}" r="60%">` +
    `<stop offset="0%" stop-color="${CARD_COLORS.vignetteInner}"/>` +
    `<stop offset="100%" stop-color="${CARD_COLORS.vignetteOuter}"/>` +
    `</radialGradient></defs>` +
    `<rect width="100%" height="100%" fill="url(#vignette)"/>` +
    mark +
    `<text x="${centerX}" y="${headline.baseline}" font-family="${SANS}" font-size="${headline.size}" font-weight="700" fill="${CARD_COLORS.headline}" text-anchor="middle" letter-spacing="${headline.tracking}">${escapeXml(words.headline)}</text>` +
    `<text x="${centerX}" y="${oneSentence.baseline}" font-family="${SANS}" font-size="${oneSentence.size}" font-weight="400" fill="${CARD_COLORS.muted}" text-anchor="middle">${escapeXml(words.oneSentence)}</text>` +
    (layout.badges ? badgesSvg(centerX, layout.badges) : "") +
    `</svg>\n`
  );
}
