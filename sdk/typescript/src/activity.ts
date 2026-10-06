import { createClient, type Client, type Transport } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { ActivityQueryController } from "@stigmer/protos/ai/stigmer/activity/v1/query_pb";
import { ListRecentActivityRequestSchema } from "@stigmer/protos/ai/stigmer/activity/v1/io_pb";
import type { RecentActivityEntry } from "@stigmer/protos/ai/stigmer/activity/v1/io_pb";
import { wrapError } from "./gen/errors.js";

export type { RecentActivityEntry };

/** Parameters for listing recent activity. */
export interface ListRecentActivityParams {
  /** Maximum entries to return. Defaults to 30. */
  readonly pageSize?: number;
  /** The organization for the org-scoped fast path, by id or slug. */
  readonly org?: string;
}

/** Response from listing recent activity. */
export interface ListRecentActivityResponse {
  readonly entries: RecentActivityEntry[];
}

/**
 * Client for the unified recent activity query.
 *
 * Returns the caller's most recent sessions, newest activity first,
 * in a single RPC call.
 */
export class ActivityClient {
  private readonly client: Client<typeof ActivityQueryController>;

  constructor(transport: Transport) {
    this.client = createClient(ActivityQueryController, transport);
  }

  async listRecentActivity(
    params?: ListRecentActivityParams,
  ): Promise<ListRecentActivityResponse> {
    try {
      const resp = await this.client.listRecentActivity(
        create(ListRecentActivityRequestSchema, {
          pageSize: params?.pageSize ?? 30,
          org: params?.org ?? "",
        }),
      );
      return { entries: [...resp.entries] };
    } catch (e) {
      throw wrapError(e);
    }
  }
}
