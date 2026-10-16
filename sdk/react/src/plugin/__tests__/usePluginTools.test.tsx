/**
 * Listing one plugin server's tools on demand. Pins: a hook held idle (no
 * plugin id, or an empty one) asks nothing when checked and stays empty;
 * only the latest check's answer lands, so a slow first answer never
 * overwrites a second one's.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { ListPluginToolsInput } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/io_pb";

import { StigmerContext } from "../../context.js";
import { usePluginTools } from "../usePluginTools.js";

afterEach(cleanup);

function wrapperFor(listTools: (input: ListPluginToolsInput) => Promise<unknown>) {
  const client = { plugin: { listTools } };
  return ({ children }: { children: ReactNode }) => <StigmerContext.Provider value={client as never}>{children}</StigmerContext.Provider>;
}

describe("usePluginTools", () => {
  it("asks nothing while held idle", async () => {
    const listTools = vi.fn(async () => ({ tools: [] }));
    for (const pluginId of [null, ""]) {
      const { result } = renderHook(() => usePluginTools(pluginId, "linear", "acme"), { wrapper: wrapperFor(listTools) });
      await act(async () => {
        await result.current.check();
      });
      expect(result.current.tools).toBeNull();
      expect(result.current.isChecking).toBe(false);
    }
    expect(listTools).not.toHaveBeenCalled();
  });

  it("keeps only the latest check's answer", async () => {
    let answerFirst: (value: unknown) => void = () => undefined;
    const listTools = vi
      .fn<(input: ListPluginToolsInput) => Promise<unknown>>()
      .mockImplementationOnce(() => new Promise((resolve) => (answerFirst = resolve)))
      .mockImplementationOnce(async () => ({ tools: [{ name: "create_issue", description: "", destructive: false }] }));
    const { result } = renderHook(() => usePluginTools("plg_1", "linear", "acme"), { wrapper: wrapperFor(listTools) });

    let first: Promise<void> = Promise.resolve();
    act(() => {
      first = result.current.check();
    });
    await act(async () => {
      await result.current.check();
    });
    await waitFor(() => expect(result.current.tools?.map((tool) => tool.name)).toEqual(["create_issue"]));

    await act(async () => {
      answerFirst({ tools: [] });
      await first;
    });
    expect(result.current.tools?.map((tool) => tool.name)).toEqual(["create_issue"]);
  });
});
