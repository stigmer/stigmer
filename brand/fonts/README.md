# Brand fonts

The faces `../type.ts` names, vendored so that nothing that draws the brand
fetches a font: the website's build (`site/src/app/fonts.ts`), the social card
(`../social-card.ts`) and the job film's test read them here. Every family is
under the SIL Open Font License 1.1; each licence is the `OFL-*.txt` beside its
files.

| File                            | Source                                                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `InstrumentSans-Variable.woff2` | google/fonts@9710da1e `ofl/instrumentsans/InstrumentSans[wdth,wght].ttf`, v1.000, `wdth` pinned at 100          |
| `Geist-Variable.woff2`          | google/fonts@9710da1e `ofl/geist/Geist[wght].ttf`, v1.800; a copy of `client-apps/web/src/app/fonts/`'s         |
| `GeistMono-Variable.woff2`      | google/fonts@9710da1e `ofl/geistmono/GeistMono[wght].ttf`, v1.701; a copy of `client-apps/web/src/app/fonts/`'s |
| `InstrumentSans-Bold.woff2`     | the same Instrument Sans source, instanced at `wdth=100 wght=700`: the social card's headline                   |

Converted with fontTools 4.66.1: `fonttools varLib.instancer <ttf> wdth=100` for
Instrument Sans (the site never sets a width, so the axis only adds bytes), and
`wdth=100 wght=700` for its bold cut, then `TTFont(ttf).flavor = "woff2"`. The
bold cut exists because the social card's font engine, fontkit 2.0.4, cannot
pick a weight from a variable WOFF2 (foliojs/fontkit#411 fixes that on fontkit's
main, in no release yet); the card reads the Geist files at their default
weight, 400. Each file is the family's full character set, not one of Google's
per-script subsets, so `→`, box-drawing in CLI output and accented names render
in the face.

`__tests__/type.test.ts` fails when a named file or its licence is missing, when
a file here is not named in `../type.ts`, when the Geist pair differs from the
console's, and when a file the card reads is not its weight at the file's
default.
