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

Choose by the background where the image will appear. The transparent white
version can look blank in a white file preview. Keep the existing clear space;
avatar services can crop the square into a circle without clipping the mark.

## Maintenance

Edit `logo.svg`, then run `npm run generate:brand` from the repository root. The
refined artwork retains the four organic forms and four separate dots, with
continuous smooth curves, circular dots, and balanced opposing forms. Each form
is one filled outline; no reinforcing strokes or masks are needed. `geometry.ts`
is generated for the inline UI marks; do not edit it directly.

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
