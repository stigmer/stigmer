/**
 * ResolveSlug — ports steps/slug.go. Derives a URL-safe slug from
 * metadata.name; idempotent when the slug is already set. NO length
 * truncation, deliberately: truncation created silent collisions between
 * different names, and the generator matches the cloud Java
 * ApiRequestResourceSlugGenerator so both editions derive identical slugs
 * (dots are namespace separators → hyphens, e.g. "platform.sara" →
 * "platform-sara").
 *
 * A derived slug is held to metadata.slug's own rules (`checkDerivedSlug`).
 * Most chains run ValidateProto before this step, so without the check a
 * name with no slug yields a slug no rule ever sees: one too long for any
 * reference to hold (stigmer#1283), or one no reference's pattern admits.
 * The rules are read from the proto through the shared validator, never
 * copied here, and a slug that breaks them is refused with its fix, never
 * shortened. Every slug the server derives outside a chain (plugin and
 * skill push, a plugin's members) calls the same check.
 */
import { create } from "@bufbuild/protobuf";
import type { DescMessage } from "@bufbuild/protobuf";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";

import { internalError, invalidArgumentError } from "../errors.js";
import type { PipelineStep } from "../pipeline.js";
import type { RequestContext } from "../request-context.js";
import { metadataOf } from "./shapes.js";
import { validator } from "./validation.js";

export function newResolveSlugStep<
  Desc extends DescMessage,
>(): PipelineStep<Desc> {
  return {
    name: "ResolveSlug",
    execute(ctx: RequestContext<Desc>): void {
      const metadata = metadataOf(ctx.newState);
      if (metadata === undefined) {
        // A server-side programming error, not bad client input (Go).
        throw internalError(
          new Error("resource metadata is nil"),
          "slug resolution",
        );
      }
      if (metadata.slug !== "") {
        return; // already set — idempotent
      }
      if (metadata.name === "") {
        // Name and slug both empty IS bad client input.
        throw invalidArgumentError("resource name is required");
      }
      const slug = generateSlug(metadata.name);
      checkDerivedSlug(slug, {
        from: `the name '${metadata.name}'`,
        fix: "set metadata.slug",
      });
      metadata.slug = slug;
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

/** Where a derived slug came from, and what the caller changes to fix it. */
export interface DerivedSlugSource {
  /** The input, quoted, as the refusal names it: `the name 'x'`. */
  readonly from: string;
  /** The remedy, imperative: `set metadata.slug`. */
  readonly fix: string;
}

/**
 * Refuses a derived slug that metadata.slug's rules would refuse had the
 * caller written it, with InvalidArgument naming the source and the fix.
 * The rules come from `ApiResourceMetadata` itself, validated through the
 * shared validator, so the bound and the pattern have one home: the proto.
 * An empty slug (a name with no ASCII letters or digits) is refused too, since
 * the proto ignores an empty slug and the resource would have none.
 */
export function checkDerivedSlug(
  slug: string,
  source: DerivedSlugSource,
): void {
  if (slug === "") {
    throw invalidArgumentError(
      `${source.from} derives no slug: it has no ASCII letters or digits; ${source.fix}`,
    );
  }
  const result = validator().validate(
    ApiResourceMetadataSchema,
    create(ApiResourceMetadataSchema, { slug }),
  );
  if (result.kind === "valid") {
    return;
  }
  if (result.kind === "invalid") {
    // The rule's own sentence ("must be at most 63 characters"), so the
    // copy names the bound without restating it.
    const reasons = result.error.violations
      .map((violation) => violation.message)
      .join(", and ");
    throw invalidArgumentError(
      `${source.from} derives the slug '${slug}' (${slug.length} characters), which is not a valid slug: it ${reasons}; ${source.fix}`,
    );
  }
  // A rule that fails to compile is a server defect, not bad input
  // (ValidateProto's mapping).
  throw internalError(result.error, "slug validation");
}
