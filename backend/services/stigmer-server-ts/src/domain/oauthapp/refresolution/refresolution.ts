/**
 * OAuthApp ref resolution — ports pkg/domain/oauthapp/refresolution: the
 * ONE answer to "which OAuthApp does this `oauth_app_ref` mean?" (the
 * defaultinstance pattern — one small module holds a cross-domain semantic
 * so its consumers cannot drift apart, stigmer/stigmer#584).
 *
 * Consumers: the OAuthApp delete guard (this domain, #13); the OAuth
 * initiate path, the read-path oauth_status enricher, and the token-refresh
 * path arrive with the mcpserver connect/OAuth sub-project (#19) and MUST
 * route through this function — three hand-rolled divergent answers are
 * exactly what #584 removed.
 *
 * Resolution semantics (OSS has a flat OAuthApp store — no org-override
 * chain like the cloud's OAuthAppResolutionService, so the ref is the whole
 * resolution): matching is by slug, with the ref's org as a preference
 * rather than a gate:
 *
 *  1. An exact (org, slug) match wins — unique by the create pipeline's
 *     duplicate check.
 *  2. Otherwise a slug-only match is honored when it is UNIQUE. This lets
 *     a self-hosted deployment satisfy seedpack refs pinned to
 *     `org: stigmer` with an OAuthApp applied in the user's own org (#584).
 *  3. Two or more slug matches with no exact hit resolve to nothing, with
 *     a WARN naming the candidate orgs: ambiguity is never silently
 *     collapsed into a credential pick.
 *
 * Returns undefined when nothing resolves; callers own the severity of that
 * outcome (the delete guard treats it as unreferenced; initiate will refuse
 * NOT_FOUND, refresh will error — #19).
 */
import { fromBinary } from "@bufbuild/protobuf";

import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { OAuthAppSchema } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/api_pb";
import type { OAuthApp } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/api_pb";

import type { Logger } from "../../../boot/logger.js";
import type { Store } from "../../../store/interface.js";

/**
 * Resolves the OAuthApp the ref means (Go refresolution.Resolve). A ref
 * without a slug resolves to nothing — an McpServerAuth with no (or an
 * empty) oauth_app_ref is the DCR/manual-token arm, not a lookup. Store
 * errors propagate to the caller (Go returns them).
 */
export async function resolveOAuthAppRef(
  store: Store,
  ref: ApiResourceReference,
  logger: Logger,
): Promise<OAuthApp | undefined> {
  if (ref.slug === "") {
    return undefined;
  }

  const rows = await store.listResources(ApiResourceKind.oauth_app);

  // Collect-then-decide: a single pass gathers every slug match so the
  // outcome depends only on the store's contents, never on its iteration
  // order (Go's earlier first-match-wins scan was nondeterministic when a
  // slug existed in several orgs).
  const slugMatches: OAuthApp[] = [];
  for (const data of rows) {
    let app: OAuthApp;
    try {
      app = fromBinary(OAuthAppSchema, data);
    } catch {
      continue; // skip malformed rows, as Go does
    }
    if ((app.metadata?.slug ?? "") !== ref.slug) {
      continue;
    }
    if (ref.org !== "" && app.metadata?.org === ref.org) {
      return app; // exact match: unique by the create duplicate check
    }
    slugMatches.push(app);
  }

  if (slugMatches.length === 0) {
    return undefined;
  }
  if (slugMatches.length === 1) {
    return slugMatches[0];
  }
  logger.warn(
    "oauth_app_ref is ambiguous (slug exists in several orgs, none matching the ref); refusing to pick — pin the ref's org to resolve",
    {
      oauthAppSlug: ref.slug,
      refOrg: ref.org,
      candidateOrgs: slugMatches.map((app) => app.metadata?.org ?? ""),
    },
  );
  return undefined;
}
