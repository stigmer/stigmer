/**
 * A public test as proof: the words of its cases, quoted as their titles say
 * them, and the file linked on GitHub. The label says "Tested in CI", not
 * "on every change": the conformance suites run on the changes that reach
 * them (scripts/ci-lanes.mjs).
 */
import type { TestsProof as TestsProofData } from "../../../../../brand/proof";
import { fileName, proofHref } from "./links";

export function TestsProof({ proof }: { proof: TestsProofData }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-mono uppercase tracking-wider text-subtle">Tested in CI</p>
      {proof.cases.map((words) => (
        <blockquote
          key={words}
          className="border-l-2 border-border pl-3 font-mono text-sm leading-relaxed text-foreground/85"
        >
          &ldquo;{words}&rdquo;
        </blockquote>
      ))}
      <a
        href={proofHref(proof.path)}
        className="self-start font-mono text-xs text-foreground underline underline-offset-4 hover:text-foreground/80 break-words"
      >
        {fileName(proof.path)}
      </a>
    </div>
  );
}
