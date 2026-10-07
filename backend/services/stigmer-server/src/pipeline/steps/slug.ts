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
 * skill push, a plugin's members) calls the same check. An update chain by
 * id is the exception (ResolveSlugOptions.update): the stored slug wins
 * there, so the derived one is never checked.
 */
import { createHash } from "node:crypto";

import { create } from "@bufbuild/protobuf";
import type { DescMessage } from "@bufbuild/protobuf";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";

import { internalError, invalidArgumentError } from "../errors.js";
import type { PipelineStep } from "../pipeline.js";
import type { RequestContext } from "../request-context.js";
import { metadataOf } from "./shapes.js";
import { validator } from "./validation.js";

/** How a chain's ResolveSlug treats the slug it derives. */
export interface ResolveSlugOptions {
  /**
   * The chain updates a stored resource. With `metadata.id` set,
   * LoadExisting reads the resource by id and BuildUpdateState puts its
   * stored slug back, so the slug derived here is never used and is not
   * held to the slug rules: an update that renames a resource whose new
   * name would derive an invalid slug still applies.
   */
  readonly update?: boolean;
}

export function newResolveSlugStep<
  Desc extends DescMessage,
>(options: ResolveSlugOptions = {}): PipelineStep<Desc> {
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
      if (options.update !== true || metadata.id === "") {
        checkDerivedSlug(slug, {
          from: `the name '${metadata.name}'`,
          fix: "set metadata.slug",
        });
      }
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

/**
 * A slug fitted to metadata.slug's rules, for a name the server chose
 * rather than the caller: an identity account's email or subject, a
 * managed environment named after the MCP server it holds tokens for. Refusing such a name (checkDerivedSlug) would refuse what no
 * caller can fix, so the slug is made to fit instead:
 *
 *   - the shared generator over the name, kept as it is whenever the rules
 *     admit it, so a valid slug is the one every earlier release derived;
 *   - nothing left (no ASCII letter or digit): the first fallback that
 *     leaves something;
 *   - not starting with a letter: `a-` in front;
 *   - longer than 63, or shorter than 2: cut to fit and suffixed with the
 *     first 8 hex digits of the source's SHA-256, so two long names that
 *     share their first 54 characters still differ.
 *
 * Names people type keep checkDerivedSlug's refusal and its fix. The store
 * migration that repairs account slugs stored before the rules held keeps
 * a frozen copy of this rule (store/account-slugs-repaired.ts).
 */
export function fittedSlug(name: string, ...fallbacks: string[]): string {
  let source = name;
  let slug = generateSlug(name);
  for (const fallback of fallbacks) {
    if (slug !== "") {
      break;
    }
    source = fallback;
    slug = generateSlug(fallback);
  }
  if (slug === "") {
    throw new Error(
      "a fitted slug needs a name or fallback with an ASCII letter or digit",
    );
  }
  if (!/^[a-z]/.test(slug)) {
    slug = `a-${slug}`;
  }
  if (slug.length > FITTED_MAX_LENGTH || slug.length < FITTED_MIN_LENGTH) {
    const hash = createHash("sha256").update(source).digest("hex").slice(0, FITTED_HASH_DIGITS);
    const head = slug.slice(0, FITTED_MAX_LENGTH - FITTED_HASH_DIGITS - 1).replace(/-+$/, "");
    slug = `${head}-${hash}`;
  }
  return slug;
}

/**
 * A name the server chose, cut to metadata.name's bound so the resource it
 * names validates on every later update: a managed environment's name is
 * the MCP server's name with a prefix in front, and an account's is an
 * email, either of which can pass the bound. The cut counts characters, as
 * the bound does, so it never splits one. A name within the bound is kept
 * as it is.
 */
export function fittedName(name: string): string {
  const characters = Array.from(name);
  return characters.length <= NAME_MAX_LENGTH
    ? name
    : characters.slice(0, NAME_MAX_LENGTH).join("");
}

/** metadata.name's bound. */
const NAME_MAX_LENGTH = 200;

/** metadata.slug's bounds, the ones every reference to a resource holds. */
const FITTED_MAX_LENGTH = 63;
const FITTED_MIN_LENGTH = 2;
const FITTED_HASH_DIGITS = 8;

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
