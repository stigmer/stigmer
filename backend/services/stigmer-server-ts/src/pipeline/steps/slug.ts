/**
 * ResolveSlug — ports steps/slug.go. Derives a URL-safe slug from
 * metadata.name; idempotent when the slug is already set. NO length
 * truncation, deliberately: truncation created silent collisions between
 * different names, and the generator matches the cloud Java
 * ApiRequestResourceSlugGenerator so both editions derive identical slugs
 * (dots are namespace separators → hyphens, e.g. "platform.sara" →
 * "platform-sara").
 */
import type { DescMessage } from "@bufbuild/protobuf";

import { internalError, invalidArgumentError } from "../errors.js";
import type { PipelineStep } from "../pipeline.js";
import type { RequestContext } from "../request-context.js";
import { metadataOf } from "./shapes.js";

export function newResolveSlugStep<Desc extends DescMessage>(): PipelineStep<Desc> {
  return {
    name: "ResolveSlug",
    execute(ctx: RequestContext<Desc>): void {
      const metadata = metadataOf(ctx.newState);
      if (metadata === undefined) {
        // A server-side programming error, not bad client input (Go).
        throw internalError(new Error("resource metadata is nil"), "slug resolution");
      }
      if (metadata.slug !== "") {
        return; // already set — idempotent
      }
      if (metadata.name === "") {
        // Name and slug both empty IS bad client input.
        throw invalidArgumentError("resource name is required");
      }
      metadata.slug = generateSlug(metadata.name);
    },
  };
}

/**
 * Go GenerateSlug: lowercase → spaces/dots to hyphens → strip
 * non-[a-z0-9- ] → collapse hyphens → trim hyphens. No truncation.
 */
export function generateSlug(name: string): string {
  let slug = name.toLowerCase();
  slug = slug.replaceAll(" ", "-").replaceAll(".", "-");
  slug = slug.replace(/[^a-z0-9\- ]/g, "");
  slug = slug.replace(/-{2,}/g, "-");
  return slug.replace(/^-+|-+$/g, "");
}
