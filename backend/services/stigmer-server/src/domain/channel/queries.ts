/**
 * The channel kind's shared read through its list index: an agent's
 * channels of every type, newest first (the agent-delete cascade and the
 * create's race guard read it). Every row is re-checked against the agent
 * it was asked for, whatever the index returned; undecodable rows are
 * skipped and logged, as the eval run's reads do (domain/eval-run/
 * queries.ts); a store fault is thrown as it came.
 */
import { fromBinary } from "@bufbuild/protobuf";

import { ChannelSchema } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/api_pb";
import type { Channel } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/api_pb";

import type { Logger } from "../../boot/logger.js";
import type { Store } from "../../store/interface.js";
import { channelListIndex } from "./list-index.js";

/** Every channel whose spec.agent_ref holds the agent's id, newest first. */
export async function listChannelsOfAgent(
  store: Store,
  logger: Logger,
  agentId: string,
): Promise<Channel[]> {
  const rows = await store.queryResources(channelListIndex, {
    anyKey: [{ name: "agent", value: agentId }],
  });
  const channels: Channel[] = [];
  for (const row of rows) {
    try {
      channels.push(fromBinary(ChannelSchema, row.data));
    } catch (error) {
      logger.warn("skipped a channel row that does not decode", {
        channelId: row.id,
        agentId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return channels.filter((channel) => (channel.spec?.agentRef?.id ?? "") === agentId);
}
