# Stigmer logo

Use **avatar.png** for GitHub, organization profiles, and other square or
circular avatar uploads. It is a 1024 × 1024 PNG with a white mark on a dark
background.

| File             | Use                                             |
| ---------------- | ----------------------------------------------- |
| `avatar.png`     | Default profile image; background included      |
| `logo.png`       | Dark mark, transparent background, 1024 × 1024  |
| `logo-white.png` | White mark, transparent background, 1024 × 1024 |
| `logo.svg`       | Dark vector mark; the canonical artwork         |
| `logo-white.svg` | White vector mark for dark backgrounds          |

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

Use the square symbol files for avatars, favicons, app icons and compact
navigation. Do not squeeze the horizontal pairing into a square upload.

Choose by the background where the image will appear. The transparent white
version can look blank in a white file preview. Keep the existing clear space;
avatar services can crop the square into a circle without clipping the mark.

## Maintenance

Edit `logo.svg`, then run `npm run generate:brand` from the repository root. The
refined artwork retains the four organic forms and four separate dots, with
continuous smooth curves, circular dots, and balanced opposing forms. Each form
is one filled outline; no reinforcing strokes or masks are needed. `geometry.ts`
is generated for the inline UI marks; do not edit it directly.

The horizontal exports combine this same symbol with `source/wordmark.svg`, the
outlined lettering in a 260 × 96 frame. The lettering uses a 48-unit capital
height and -0.35-unit tracking, paired with a 96-unit symbol frame. Regenerate
the exports with the same `npm run generate:brand` command; do not edit the
generated lockups or their website copy. Changing this pairing does not change
the symbol or the favicons.

Typeface credit:
[Instrument Sans](https://github.com/Instrument/instrument-sans), Copyright 2022
The Instrument Sans Project Authors, available under the
[SIL Open Font License 1.1](https://github.com/google/fonts/blob/main/ofl/instrumentsans/OFL.txt).
Only the outlined product name is included here, not the font software.

The website, web console and desktop icon generators read this same source.
Their favicon, touch-icon, PWA, ICO and ICNS sizes are platform outputs, not
additional logo choices. Regenerate them with:

```sh
npm run generate-images --prefix site
npm run generate-images -w web
npm run generate:icons -w desktop
```

Desktop ICNS generation requires macOS's `iconutil`. The desktop generator also
refreshes the monochrome tray icon. The website generator refreshes the README
banner. Test the pipeline with `npm run test:brand`.
