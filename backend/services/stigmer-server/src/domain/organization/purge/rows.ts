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
 * most `limit` ids and a `next` token, undefined on the last page; a
 * stage that removes what it finds may simply read from the start again.
 *
 * It matches `metadata.org` only. The kinds whose rows name their
 * organization elsewhere or live behind a port a composition substitutes
 * (an API key's bound organization; identity accounts, platform clients
 * and policy rows, which the kind purges read through their ports) are
 * refused rather than answered wrong, as is a limit that is not a
 * positive integer. A `next` names the kind and the read it came from, so
 * a token from another kind's or another read's page is refused too,
 * never taken as a position that would end the read early.
 *
 * What the tests pin (__tests__/rows.test.ts): only the organization's ids,
 * in pages that resume where the last ended, for an indexed kind and for
 * one with no list index, on a real SQLite store; and each refusal.
 */
import type { DescMessage, Message } from "@bufbuild/protobuf";
import { fromBinary } from "@bufbuild/protobuf";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type {
  OrganizationRowPage,
  OrganizationRows,
} from "../../../extensions/organization-purge.js";
import { kindEnumName } from "../../../pipeline/apiresource-meta.js";
import { metadataOf } from "../../../pipeline/steps/shapes.js";
import type { Store } from "../../../store/interface.js";
import type {
  ListIndexCursor,
  ListIndexDeclaration,
} from "../../../store/list-index.js";

/** How many rows a keyset page reads when a kind has no list index. */
const SCAN_PAGE = 500;

/** Kinds whose rows `metadata.org` does not place (kind-purge.ts's `belongsTo` and `rows`). */
const REFUSED_KINDS: ReadonlySet<ApiResourceKind> = new Set([
  ApiResourceKind.api_key,
  ApiResourceKind.iam_policy,
  ApiResourceKind.identity_account,
  ApiResourceKind.platform_client,
]);

/** Which read a page came from. */
type Read = "index" | "scan";

/** What a `next` token carries: the kind and the read it belongs to, and the position. */
interface PageToken {
  readonly kind: string;
  readonly read: Read;
  readonly id: string;
  /** The index position's creation stamp; "" for a scan. */
  readonly createdAt: string;
}

function tokenOf(
  kind: ApiResourceKind,
  read: Read,
  id: string,
  createdAt = "",
): string {
  const token: PageToken = { kind: kindEnumName(kind), read, id, createdAt };
  return JSON.stringify(token);
}

/** The position `after` names, refused unless this kind's `read` wrote it. */
function positionOf(
  kind: ApiResourceKind,
  read: Read,
  after: string,
): PageToken {
  let parsed: unknown;
  try {
    parsed = JSON.parse(after);
  } catch {
    parsed = undefined;
  }
  const token = parsed as Partial<PageToken> | undefined;
  if (
    token?.kind !== kindEnumName(kind) ||
    token.read !== read ||
    typeof token.id !== "string" ||
    typeof token.createdAt !== "string"
  ) {
    throw new Error(
      `organization rows: \`after\` is not a page's \`next\` from the ${kindEnumName(kind)} reader`,
    );
  }
  return { kind: token.kind, read, id: token.id, createdAt: token.createdAt };
}

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
    const from: ListIndexCursor | undefined =
      after === "" ? undefined : positionOf(index.kind, "index", after);
    const rows = await store.queryResources(index, {
      org,
      limit,
      ...(from === undefined
        ? {}
        : { after: { createdAt: from.createdAt, id: from.id } }),
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
          : tokenOf(index.kind, "index", last.cursor.id, last.cursor.createdAt),
    };
  }

  async function scanned(
    kind: ApiResourceKind,
    schema: DescMessage,
    after: string,
    limit: number,
  ): Promise<OrganizationRowPage> {
    const ids: string[] = [];
    let from = after === "" ? "" : positionOf(kind, "scan", after).id;
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
            return { ids, next: tokenOf(kind, "scan", raw.id) };
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
    async ids(kind, schema, { after, limit }) {
      if (REFUSED_KINDS.has(kind)) {
        throw new Error(
          `organization rows: ${kindEnumName(kind)} rows do not name their organization in metadata.org`,
        );
      }
      if (!Number.isInteger(limit) || limit <= 0) {
        throw new Error(
          `organization rows: a page's limit is a positive integer, not ${limit}`,
        );
      }
      const index = indexOf.get(kind);
      return index === undefined
        ? scanned(kind, schema, after, limit)
        : indexed(index, schema, after, limit);
    },
  };
}
