/**
 * The organization's rows of one kind, for a purge stage that finds its
 * own rows through them (an edition's checkpoints by session, its output
 * files by execution): `OrganizationPurgeContext.rows`.
 *
 * Rows are read where the store keeps them, the kind purges' rule
 * (kind-purge.ts): through the kind's list index when the composition
 * declares one, so a page reads only the organization's index entries;
 * otherwise in keyset pages of the kind, decoding each row's
 * `metadata.org`, which the kinds without a list index make cheap
 * (boot/list-indexes.ts says how few rows they hold). A page answers at
 * most `limit` ids and an opaque `next`, undefined on the last page; a
 * stage that removes what it finds may simply read from the start again.
 *
 * What the tests pin (__tests__/rows.test.ts): only the organization's ids,
 * in pages that resume where the last ended, for an indexed kind and for
 * one with no list index, on a real SQLite store.
 */
import type { DescMessage, Message } from "@bufbuild/protobuf";
import { fromBinary } from "@bufbuild/protobuf";

import type { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type {
  OrganizationRowPage,
  OrganizationRows,
} from "../../../extensions/organization-purge.js";
import { metadataOf } from "../../../pipeline/steps/shapes.js";
import type { Store } from "../../../store/interface.js";
import type {
  ListIndexCursor,
  ListIndexDeclaration,
} from "../../../store/list-index.js";

/** How many rows a keyset page reads when a kind has no list index. */
const SCAN_PAGE = 500;

export function newOrganizationRows(
  store: Pick<Store, "queryResources" | "findResourcesRawOrderedAfter">,
  listIndexes: ReadonlyArray<ListIndexDeclaration>,
  org: string,
): OrganizationRows {
  const indexOf = new Map(listIndexes.map((index) => [index.kind, index]));
  const orgOf = (schema: DescMessage, data: Uint8Array): string =>
    metadataOf(fromBinary(schema, data) as Message)?.org ?? "";

  async function indexed(
    index: ListIndexDeclaration,
    schema: DescMessage,
    after: string,
    limit: number,
  ): Promise<OrganizationRowPage> {
    const rows = await store.queryResources(index, {
      org,
      limit,
      ...(after === "" ? {} : { after: JSON.parse(after) as ListIndexCursor }),
    });
    const last = rows[rows.length - 1];
    return {
      // The index holds the organization's entries; the row's own
      // organization is checked as the kind purges check it.
      ids: rows
        .filter((row) => orgOf(schema, row.data) === org)
        .map((row) => row.id),
      next:
        rows.length < limit || last === undefined
          ? undefined
          : JSON.stringify(last.cursor),
    };
  }

  async function scanned(
    kind: ApiResourceKind,
    schema: DescMessage,
    after: string,
    limit: number,
  ): Promise<OrganizationRowPage> {
    const ids: string[] = [];
    let from = after;
    for (;;) {
      const page = await store.findResourcesRawOrderedAfter(
        kind,
        from,
        SCAN_PAGE,
      );
      for (const raw of page) {
        if (orgOf(schema, raw.data) === org) {
          ids.push(raw.id);
          if (ids.length >= limit) {
            return { ids, next: raw.id };
          }
        }
      }
      if (page.length < SCAN_PAGE) {
        return { ids, next: undefined };
      }
      from = page[page.length - 1]!.id;
    }
  }

  return {
    ids(kind, schema, { after, limit }) {
      const index = indexOf.get(kind);
      return index === undefined
        ? scanned(kind, schema, after, limit)
        : indexed(index, schema, after, limit);
    },
  };
}
