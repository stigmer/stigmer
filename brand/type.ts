/**
 * The brand's type: which face sets which words, and the files each face is
 * drawn from.
 *
 * Three roles. Display is Instrument Sans, the face the lockup's lettering is
 * drawn in, and it sets only the words a page is named by: page titles,
 * section headlines, the homepage's closing line, the header's "Stigmer", and
 * a film's headline and close. Everything else (paragraphs, buttons, row
 * titles, figures, code) is Geist and Geist Mono, the letters the product
 * itself uses (`sdk/theme/src/tokens.css`), so the words under a screenshot
 * read in the screenshot's own letters.
 *
 * The files sit beside this module in `fonts/`, vendored so that nothing that
 * draws the brand fetches a font: the website's build (`site/src/app/fonts.ts`),
 * the social card (`social-card.ts`) and the job film's test read them here.
 * The Geist pair is byte-identical to the console's
 * (`client-apps/web/src/app/fonts/`), which `__tests__/type.test.ts` holds.
 * Provenance and licences: `fonts/README.md`.
 */

/** One face as the brand uses it. */
export interface TypeFace {
  /** The family name, as the face's own name table and Google Fonts give it. */
  readonly family: string;
  /** The variable font file in `brand/fonts/`. */
  readonly file: string;
  /** The weight range the file covers, lowest first. */
  readonly weights: readonly [number, number];
  /** The licence file in `brand/fonts/` that the face ships under. */
  readonly licence: string;
}

export const TYPE = {
  /** Page titles, section headlines, the closing line, the name, a film's headline and close. */
  display: {
    family: "Instrument Sans",
    file: "InstrumentSans-Variable.woff2",
    weights: [400, 700],
    licence: "OFL-InstrumentSans.txt",
  },
  /** Every other word: paragraphs, buttons, row titles, figures. */
  sans: {
    family: "Geist",
    file: "Geist-Variable.woff2",
    weights: [100, 900],
    licence: "OFL-Geist.txt",
  },
  /** Code, commands, labels set in monospace. */
  mono: {
    family: "Geist Mono",
    file: "GeistMono-Variable.woff2",
    weights: [100, 900],
    licence: "OFL-Geist.txt",
  },
} as const satisfies Record<string, TypeFace>;

export type TypeRole = keyof typeof TYPE;
