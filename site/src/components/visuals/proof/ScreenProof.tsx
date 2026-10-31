/**
 * A picture the visual suite draws, as proof: the bare picture, offered at
 * the width of the homepage's proof column (seven of twelve on a large
 * screen, the whole width below it), and opening the sharpest file on a
 * click, where a phone's narrow column would leave its words too small.
 */
import type { ScreenProof as ScreenProofData } from "../../../../../brand/proof";
import { SHOWN_SCALE, screenPath } from "@/lib/screens";
import { ScreenImage } from "../ScreenImage";

/** The slot the picture fills: the proof column, about 700 CSS px at the page's widest. */
export const PROOF_IMAGE_SIZES = "(min-width: 1024px) 700px, 100vw";

export function ScreenProof({ proof }: { proof: ScreenProofData }) {
  return (
    <a href={screenPath(proof.name, SHOWN_SCALE)} className="block rounded-md focus-visible:outline-2 focus-visible:outline-offset-2">
      <ScreenImage
        name={proof.name}
        alt={proof.alt}
        sizes={PROOF_IMAGE_SIZES}
        className="w-full rounded-md border border-border"
      />
    </a>
  );
}
