"use client";

/**
 * The tools one of a plugin's MCP servers lists right now, asked on
 * demand ("Check tools") and never stored.
 *
 * `listTools` reaches the server as the caller, through the organization's
 * runner, with the keys and the login My vault holds for it, and answers
 * what the server listed: nothing is recorded on the plugin, so the answer
 * is as fresh as the click and a server the caller has not signed in to
 * yet answers with the server's own refusal, which is the message shown.
 * Nothing is fetched until `check` is called: listing starts the server,
 * which costs a process or a network round trip a page view should not.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { create } from "@bufbuild/protobuf";
import { ListPluginToolsInputSchema, type PluginTool } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link usePluginTools}. */
export interface UsePluginToolsReturn {
  /** The tools the last check listed, or `null` before the first one lands. */
  readonly tools: readonly PluginTool[] | null;
  /** `true` while a check is in flight. */
  readonly isChecking: boolean;
  /** The last check's failure, or `null`. */
  readonly error: Error | null;
  /** Ask the server for its tools now. */
  readonly check: () => Promise<void>;
}

/**
 * Behaviour hook for listing one plugin server's tools.
 *
 * @param pluginId - The plugin's id; `null` holds the hook idle.
 * @param server - The server's name in the plugin.
 * @param org - The organization whose runner reaches the server.
 *
 * @example
 * ```tsx
 * const tools = usePluginTools(plugin.metadata.id, "linear", org);
 * <button onClick={() => void tools.check()}>Check tools</button>
 * ```
 */
export function usePluginTools(pluginId: string | null, server: string, org: string): UsePluginToolsReturn {
  const stigmer = useStigmer();
  const [tools, setTools] = useState<readonly PluginTool[] | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  // Only the latest check's answer lands: a slow first click never
  // overwrites a second one's.
  const turnRef = useRef(0);

  const check = useCallback(async () => {
    if (pluginId === null || pluginId === "") return;
    const turn = ++turnRef.current;
    setIsChecking(true);
    setError(null);
    try {
      const output = await stigmer.plugin.listTools(create(ListPluginToolsInputSchema, { pluginId, server, org }));
      if (turn === turnRef.current) setTools(output.tools);
    } catch (err) {
      if (turn === turnRef.current) setError(toError(err));
    } finally {
      if (turn === turnRef.current) setIsChecking(false);
    }
  }, [stigmer, pluginId, server, org]);

  return useMemo(() => ({ tools, isChecking, error, check }), [tools, isChecking, error, check]);
}
