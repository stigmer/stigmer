# Stigmer logo

Use **avatar.png** for GitHub, organization profiles, and other square or
circular avatar uploads. It is a 1024 × 1024 PNG of the shaded mark on a
graphite background.

The mark comes in two forms. The **shaded** mark lights each face of the hexagon
and of the inner cube in its own gray, so it reads as a solid object. It is the
default for website and docs headers,
lockups, avatars, sign-in branding, app icons, touch icons and social images.
The **flat** mark is one color; reserve it for tiny favicons, the menu bar icon,
and anywhere a single ink is required. There is no blanket 48 px cutoff: check
the artwork at its actual display size.

The logo uses two tones, never pure black or white: graphite `#1c1c1e` for the
dark mark and dark backgrounds, and light gray `#ededed` for the light mark and
light backgrounds. "White" in the file names below means this light tone.
`assets.mts` exports them as `BRAND_DARK` and `BRAND_LIGHT`; every generator
reads those names.

| File                    | Use                                                         |
| ----------------------- | ----------------------------------------------------------- |
| `avatar.png`            | Default profile image; shaded, background included          |
| `logo-shaded.png`       | Shaded mark for light backgrounds, transparent, 1024 × 1024 |
| `logo-shaded-white.png` | Shaded mark for dark backgrounds, transparent, 1024 × 1024  |
| `logo-shaded.svg`       | Shaded vector mark for light backgrounds                    |
| `logo-shaded-white.svg` | Shaded vector mark for dark backgrounds                     |
| `logo.png`              | Flat dark mark, transparent background, 1024 × 1024         |
| `logo-white.png`        | Flat white mark, transparent background, 1024 × 1024        |
| `logo.svg`              | Flat dark vector mark; the canonical outline                |
| `logo-white.svg`        | Flat white vector mark for dark backgrounds                 |

The default lockups are shaded. The `logo-lockup-flat` SVG and PNG files (with
`-white` variants) preserve the one-color pairing for single-ink uses.

Use **logo-lockup.svg** when the name should appear beside the symbol, such as a
website header, presentation or sponsorship listing. The horizontal pairing uses
Instrument Sans Semibold (600), with the lettering converted to outlines so it
displays without a font download. Keep its proportions and spacing.

| File                    | Use                                  |
| ----------------------- | ------------------------------------ |
| `logo-lockup.svg`       | Dark horizontal symbol and name      |
| `logo-lockup-white.svg` | White horizontal symbol and name     |
| `logo-lockup.png`       | Dark transparent upload, 1536 × 405  |
| `logo-lockup-white.png` | White transparent upload, 1536 × 405 |

The LinkedIn covers carry the words as well as the mark. Each is drawn for what
LinkedIn lays over it: the profile photo at the cover's lower left, the page
logo at the banner's.

| File                         | Use                                            |
| ---------------------------- | ---------------------------------------------- |
| `linkedin-cover.png`         | The founder's LinkedIn cover, 1584 × 396       |
| `linkedin-company-cover.png` | The Stigmer LinkedIn page's banner, 1128 × 191 |

Use the square symbol files for avatars, favicons, app icons and compact
navigation. Do not squeeze the horizontal pairing into a square upload.

Choose by the background where the image will appear. The transparent white
version can look blank in a white file preview. Keep the existing clear space;
avatar services can crop the square into a circle without clipping the mark.

## Words

`positioning.ts` holds what Stigmer is in the words every surface uses: the
headline, the subhead and the one sentence. The website's title, description,
social cards, web manifest and llms.txt, its Open Graph image, the web console's
description and the two LinkedIn covers all import them from there. Their public
form, with the rules for using them, is the "What Stigmer is, and who it is for"
section of `docs/vocabulary.md`. To change the words, change that section and
this file together; `__tests__/positioning.test.ts` fails, naming the copy,
while the vocabulary or the docs front page disagrees, or while a site or
console source spells the words out instead of importing them. The covers are
uploads, which no test can read: after a words change, run
`npm run generate:brand` and upload both covers again by hand.

## Maintenance

Edit `logo.svg`, then run `npm run generate:brand` from the repository root. The
three-fin mark is a closed hexagonal enclosure with three broad, angled fins
joined to its lower-right wall, each rising the full height of the inner cube's
side. The inner negative space gives the impression of a cube. It is one filled
outline with a transparent interior; no strokes, masks, gradients or separate
dots are needed. `geometry.ts` and `shaded-geometry.ts` are generated for inline UI marks; do not
edit them directly.

`source/shaded.svg` draws the shaded mark over the same outline as seven filled
faces, in this order: the inner cube's top, left and right, then the hexagon's
top, left and right, then the fins. Its fills are the tones for a dark
background; `SHADED_TONES` in `assets.mts` holds both lightings, and each face
is named by `data-face`. Where two faces meet, the face drawn first extends a
little under the next, so no background shows through the join. A change to the
outline in `logo.svg` must be made in `source/shaded.svg` too; the brand tests
fail when the two outlines drift apart.

The horizontal exports combine this same symbol with `source/wordmark.svg`, the
outlined lettering in a 260 × 96 frame. The lettering uses a 48-unit capital
height and -0.35-unit tracking, paired with a 96-unit symbol frame. The
generator lowers the lettering by 7.2 units for optical centering, equivalent to
3 px at the website header's 40 px height. Regenerate the exports with the same
`npm run generate:brand` command; do not edit the generated lockups or their
website copy. Changing this pairing does not change the symbol or the favicons.

Typeface credit:
[Instrument Sans](https://github.com/Instrument/instrument-sans), Copyright 2022
The Instrument Sans Project Authors, available under the
[SIL Open Font License 1.1](https://github.com/google/fonts/blob/main/ofl/instrumentsans/OFL.txt).
Only the outlined product name is included here, not the font software.

The website, web console and desktop icon generators read these same sources.
Their favicon, touch-icon, PWA, ICO and ICNS sizes are platform outputs, not
additional logo choices. Regenerate them with:

```sh
npm run generate-images --prefix site
npm run generate-images -w web
npm run generate:icons -w desktop
```

`social-card.ts` holds the social card's three layouts: the website's Open Graph
image, which the website generator draws, and the two LinkedIn covers, which
`npm run generate:brand` draws. Each layout states where its mark, words and
badges sit; change a layout there, not in a generator.

Desktop ICNS generation requires macOS's `iconutil`. The desktop generator also
refreshes the monochrome tray icon. The website generator refreshes the README
banner. Test the pipeline with `npm run test:brand`.

## Artwork provenance

The mark adapts [Cubicle from Logodust](https://www.logodust.com/), replacing
its four fine interior bars with three broader fins. The underlying artwork is
available for commercial and noncommercial use under the
[Logodust license](https://www.logodust.com/license.html). Downloaded marks are
nonexclusive and cannot be claimed or trademarked. The repository's software
license does not supersede these artwork terms. See `LICENSE.txt` for the source
and the published terms.
