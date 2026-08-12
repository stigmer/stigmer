/**
 * The deep-agent harness's MCP gate: whether this execution enters MCP
 * resolution at all (resolve, backfill, synthesized-attachment
 * injection, connect). Unlike the Cursor harness — which resolves MCP
 * unconditionally — deep-agent skips the whole block when no tool
 * source exists, so EVERY tool source must appear here or its tools are
 * silently dropped for exactly the agents whose only source it is
 * (proactive-messaging DD-006 D7 learned this for channel messaging).
 *
 * Extracted from setup.ts as a pure function because setup.ts is
 * untestable at file load (its import graph is why no setup.test.ts
 * exists); the gate is the one piece whose regression is silent, so it
 * gets its own module and an arm-by-arm test.
 */

/** One flag per tool source. Adding a source? It gates here or it is dropped. */
export interface McpToolSources {
  /** Declared MCP server usages (agent spec + session spec). */
  readonly mcpServerUsageCount: number;
  /** Serving proactive-messaging channels (the channels attachment, DD-006). */
  readonly channelMessagingCount: number;
  /** The serving channel id when this session IS a live channel
   *  conversation (the conversation attachment, DD-008). */
  readonly conversationChannelId: string | undefined;
}

/** True when any tool source demands MCP resolution and connect. */
export function shouldConnectMcp(sources: McpToolSources): boolean {
  return (
    sources.mcpServerUsageCount > 0 ||
    sources.channelMessagingCount > 0 ||
    sources.conversationChannelId !== undefined
  );
}
