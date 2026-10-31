/**
 * A file or a page as proof: a labelled link, to the site or to the file on
 * GitHub, with where it goes written under it, so a visitor sees it is the
 * repository's own file or the site's own guide before they click.
 */
import type { SourceProof as SourceProofData } from "../../../../../brand/proof";
import { SITE_CONFIG } from "@/lib/constants";
import { proofHref } from "./links";

/** Where a proof's link goes, as a reader would say it: the repository and file, or the site's page. */
export function destination(target: string): string {
  if (target.startsWith("/")) return `${new URL(SITE_CONFIG.url).host}${target}`;
  return `${new URL(SITE_CONFIG.githubUrl).pathname.slice(1)} · ${target}`;
}

export function SourceProof({ proof }: { proof: SourceProofData }) {
  return (
    <div className="flex flex-col gap-1">
      <a
        href={proofHref(proof.href)}
        className="self-start text-sm text-foreground underline underline-offset-4 hover:text-foreground/80"
      >
        {proof.label}
      </a>
      <span className="font-mono text-xs text-subtle break-words">{destination(proof.href)}</span>
    </div>
  );
}
