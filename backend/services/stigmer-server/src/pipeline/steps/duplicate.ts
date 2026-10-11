/**
 * CheckDuplicate — ports steps/duplicate.go. Rejects a create whose slug
 * another resource of the kind already holds in the same organization,
 * read through the name table (pipeline/steps/names.ts). It is the early,
 * readable refusal, before any side effect; the guarantee is ClaimName's,
 * immediately before Persist, because two creates can both pass this read.
 * A name whose holder's row is gone does not refuse here: the claim frees
 * it. Domains with different uniqueness rules bring their own step under
 * the same name (organization: global by id — see the domain's steps
 * module).
 */
import type { DescMessage } from "@bufbuild/protobuf";
import { ConnectError } from "@connectrpc/connect";

import type { Store } from "../../store/interface.js";
import { getKindName } from "../apiresource-meta.js";
import { alreadyExistsError, internalError } from "../errors.js";
import type { PipelineStep } from "../pipeline.js";
import type { RequestContext } from "../request-context.js";
import { findResourceByName } from "./names.js";
import { metadataOf } from "./shapes.js";

export function newCheckDuplicateStep<Desc extends DescMessage>(
  store: Store,
): PipelineStep<Desc> {
  return {
    name: "CheckDuplicate",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const metadata = metadataOf(ctx.newState);
      if (metadata === undefined) {
        // Established by earlier steps — a server-side programming error.
        throw internalError(
          new Error("resource metadata is nil"),
          "duplicate check",
        );
      }
      if (metadata.slug === "") {
        throw internalError(
          new Error("resource slug is empty"),
          "duplicate check",
        );
      }

      let existing;
      try {
        existing = await findResourceByName(
          store,
          ctx.apiResourceKind,
          ctx.schema,
          metadata.org,
          metadata.slug,
        );
      } catch (error) {
        if (error instanceof ConnectError) {
          throw error;
        }
        throw internalError(error, "failed to check for duplicates");
      }

      if (existing !== undefined) {
        const existingMetadata = metadataOf(existing);
        throw alreadyExistsError(
          getKindName(ctx.apiResourceKind),
          `slug '${metadata.slug}' in org '${existingMetadata?.org ?? ""}' (id: ${existingMetadata?.id ?? ""})`,
        );
      }
    },
  };
}
