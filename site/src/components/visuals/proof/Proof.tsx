/**
 * One proof, drawn by its kind (brand/proof.ts): the measured wake, a
 * picture the visual suite draws, a public test in its own words, or a
 * labelled link. The switch names every kind and has no default, so a kind
 * added to the brand fails the typecheck here until it is drawn.
 */
import type { ReactElement } from "react";
import type { Proof as ProofData } from "../../../../../brand/proof";
import { ScreenProof } from "./ScreenProof";
import { SourceProof } from "./SourceProof";
import { TestsProof } from "./TestsProof";
import { WakeProof } from "./WakeProof";

export function Proof({ proof }: { proof: ProofData }): ReactElement {
  switch (proof.kind) {
    case "measurement":
      return <WakeProof />;
    case "screen":
      return <ScreenProof proof={proof} />;
    case "tests":
      return <TestsProof proof={proof} />;
    case "source":
      return <SourceProof proof={proof} />;
  }
}
