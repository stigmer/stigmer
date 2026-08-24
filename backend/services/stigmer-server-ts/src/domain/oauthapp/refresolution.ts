/**
 * OAuthApp reference resolution — ports pkg/domain/oauthapp/refresolution:
 * the OSS semantics of resolving an `oauth_app_ref` (an
 * ApiResourceReference on McpServerAuth) to a stored OAuthApp. One small
 * module holds a cross-domain semantic so its consumers cannot drift
 * apart (stigmer/stigmer#584, which found three divergent hand-rolled
 * answers): the read-path oauth_status enricher (mcpserver, #9), the
 * OAuth initiate and token-refresh paths (#19 — refresh MUST use the app
 * initiate selected or it runs against the wrong vendor credentials), and
 * the OAuthApp delete guard (#13). This file seeds src/domain/oauthapp/;
 * the domain's controllers arrive with #13.
 *
 * Resolution semantics: OSS has a flat OAuthApp store — no org-override
 * chain like the cloud's OAuthAppResolutionService, so the ref is the
 * whole resolution (#558 DD-019). Matching is by slug, with the ref's org
 * as a preference rather than a gate:
 *
 *  1. An exact (org, slug) match wins. Uniqueness is guaranteed by the
 *     create pipeline's duplicate check.
 *  2. Otherwise a slug-only match is honored when it is UNIQUE — what
 *     lets a self-hosted deployment satisfy seedpack refs pinned to
 *     `org: stigmer` with an OAuthApp applied in the user's own org.
 *  3. Two or more slug matches with no exact hit resolve to nothing, with
 *     a WARN naming the candidate orgs: ambiguity is never silently
 *     collapsed into a credential pick.
 *
 * Returns undefined when nothing resolves; callers own the severity of
 * that outcome (the enricher skips, initiate refuses NOT_FOUND, token
 * refresh errors, the delete guard treats it as unreferenced).
 *
 * Proven by __tests__/refresolution.test.ts (Go's table ported).
 */
import { fromBinary } from "@bufbuild/protobuf";

import { OAuthAppSchema } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/api_pb";
import type { OAuthApp } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/api_pb";
import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import type { Store } from "../../store/interface.js";

/**
 * Resolves the OAuthApp the ref means (Go refresolution.Resolve). A ref
 * without a slug resolves to nothing — an McpServerAuth with no (or an
 * empty) oauth_app_ref is the DCR/manual-token arm, not a lookup.
 * Storage failures propagate; callers own their severity.
 */
export async function resolveOAuthAppRef(
  store: Store,
  ref: ApiResourceReference | undefined,
  logger: Logger,
): Promise<OAuthApp | undefined> {
  const slug = ref?.slug ?? "";
  if (slug === "") {
    return undefined;
  }

  const rows = await store.listResources(ApiResourceKind.oauth_app);

  // Collect-then-decide: a single pass gathers every slug match so the
  // outcome depends only on the store's contents, never on its iteration
  // order (Go's previous first-match-wins scan was nondeterministic when
  // a slug existed in several orgs).
  const slugMatches: OAuthApp[] = [];
  for (const data of rows) {
    let app: OAuthApp;
    try {
      app = fromBinary(OAuthAppSchema, data);
    } catch {
      continue; // skip malformed rows, as Go does
    }
    if ((app.metadata?.slug ?? "") !== slug) {
      continue;
    }
    const refOrg = ref?.org ?? "";
    if (refOrg !== "" && app.metadata?.org === refOrg) {
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
      oauthAppSlug: slug,
      refOrg: ref?.org ?? "",
      candidateOrgs: slugMatches.map((app) => app.metadata?.org ?? ""),
    },
  );
  return undefined;
}
