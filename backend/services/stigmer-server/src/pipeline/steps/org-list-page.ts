/**
 * One page of an organization's rows of one kind, newest first, through
 * the kind's list index, narrowed last by the composed read scope: the
 * whole body of a kind's plain `list` RPC (agent, skill, plugin), whose
 * request names an organization and, optionally, labels every row must
 * carry (an exact AND match, each row's keep inside the page loop).
 *
 * A row that does not decode is skipped with a warning, as every list
 * lane skips one; the page loop (list-page.ts) owns the size, the budget
 * and the token.
 *
 * Proven by __tests__/org-list-page.test.ts and end to end by the list
 * arms of the conformance suites.
 */
import { fromBinary } from "@bufbuild/protobuf";
import type { Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv1";

import type { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import type {
  ListReadScope,
  ScopedListResource,
} from "../../extensions/list-read-scope.js";
import { restrictListByReadScope } from "../../extensions/list-read-scope.js";
import type { Store } from "../../store/interface.js";
import type { ListIndexDeclaration } from "../../store/list-index.js";
import { apiResourceKindName } from "../../store/proto-fields.js";
import { matchesAllLabels, sortedLabels } from "./helpers.js";
import { listPageFingerprint, readListPage } from "./list-page.js";
import type { ListPage, ListPageRequest } from "./list-page.js";

/** What one organization list reads. */
export interface OrgListPageParams<T extends Message & ScopedListResource> {
  readonly store: Store;
  readonly logger: Logger;
  readonly listReadScope: ListReadScope | undefined;
  readonly caller: CallerIdentity;
  readonly kind: ApiResourceKind;
  readonly schema: GenMessage<T>;
  readonly declaration: ListIndexDeclaration;
  readonly request: ListPageRequest & {
    readonly org: string;
    readonly labels: Readonly<Record<string, string>>;
  };
}

/** Reads one page of `request.org`'s rows of `kind`. */
export function readOrgListPage<T extends Message & ScopedListResource>(
  params: OrgListPageParams<T>,
): Promise<ListPage<T>> {
  const kindName = apiResourceKindName(params.kind);
  const org = params.request.org;
  return readListPage<T, string>({
    store: params.store,
    declaration: params.declaration,
    query: { org },
    request: params.request,
    fingerprint: listPageFingerprint({
      lane: `${kindName}.list`,
      org,
      labels: sortedLabels(params.request.labels),
    }),
    decode: (data) => {
      try {
        return fromBinary(params.schema, data);
      } catch (error) {
        params.logger.warn(`Failed to unmarshal ${kindName}, skipping`, {
          error: error instanceof Error ? error.message : String(error),
        });
        return undefined;
      }
    },
    keep: (row) =>
      matchesAllLabels(row.metadata?.labels ?? {}, params.request.labels),
    scope: (rows) =>
      restrictListByReadScope(
        params.listReadScope,
        params.caller,
        params.kind,
        rows,
        "",
      ),
    failure: `failed to list ${kindName.replaceAll("_", " ")}s`,
  });
}
