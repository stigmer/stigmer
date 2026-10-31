/**
 * What a claim on the site points at to show it is true. Every proof is
 * something real a visitor can check: a figure measured with its date, a
 * picture the visual tests draw, a public test quoted in its own words, or a
 * file or page anyone can read. Nothing here is an illustration.
 *
 * The site renders a proof by its kind (site/src/components/visuals/proof/),
 * and brand/__tests__/proofs.test.ts holds each one to what it names: the
 * test file and its case, the shown picture, the file or page. A renamed test
 * or a reworded case fails the change that made it, naming the proof.
 */

/** A figure from brand/measurements.ts, printed with its date and environment. */
export interface MeasurementProof {
  readonly kind: "measurement";
  /** Which measurement: the sandbox's wake (`SANDBOX_WAKE`). */
  readonly figure: "sandbox-wake";
}

/** A picture the visual suite draws, by its name in test/visual/src/shown.ts. */
export interface ScreenProof {
  readonly kind: "screen";
  readonly name: string;
  /** What the picture shows, for a reader who cannot see it. */
  readonly alt: string;
}

/** A public test file and the words of its cases, as each case's title says them after its `[rpc:…]` tags. */
export interface TestsProof {
  readonly kind: "tests";
  /** The file, from the repository's root. */
  readonly path: string;
  readonly cases: readonly string[];
}

/** A file in the repository (a path from its root) or a page of the site (a path starting with "/"). */
export interface SourceProof {
  readonly kind: "source";
  /** The link's words. */
  readonly label: string;
  readonly href: string;
}

export type Proof = MeasurementProof | ScreenProof | TestsProof | SourceProof;
