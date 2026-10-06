/**
 * A failed delete says why. Pins: the error toast carries the server's
 * sentence as its description, so a plugin whose removal is refused names
 * what still uses it and what to undo; the hook rejects with the error and
 * holds it; a successful delete toasts the resource's name.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { Code, ConnectError } from "@connectrpc/connect";

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("../../feedback/toast.js", () => ({ toast: toastMock }));

import { StigmerContext } from "../../context.js";
import { useDeleteResource } from "../useDeleteResource.js";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const REFUSAL = "plugin 'hookify' is still used by agent 'reviewer'; switch the plugin's hooks off on them first";

function renderDelete(remove: () => Promise<unknown>) {
  const client = { plugin: { delete: vi.fn(remove) } };
  const wrapper = ({ children }: { children: ReactNode }) => <StigmerContext.Provider value={client as never}>{children}</StigmerContext.Provider>;
  return renderHook(() => useDeleteResource("plugin", "plg_1", "hookify"), { wrapper });
}

describe("useDeleteResource", () => {
  it("shows the server's refusal as the error toast's description", async () => {
    const hook = renderDelete(async () => {
      throw new ConnectError(REFUSAL, Code.FailedPrecondition);
    });
    await act(async () => {
      await expect(hook.result.current.deleteResource()).rejects.toThrow(/still used by agent 'reviewer'/);
    });
    expect(toastMock.error).toHaveBeenCalledWith("Failed to delete plugin", { description: REFUSAL });
    expect(hook.result.current.error?.message).toMatch(/still used by agent 'reviewer'/);
  });

  it("toasts the resource's name when the delete goes through", async () => {
    const hook = renderDelete(async () => ({}));
    await act(async () => {
      await hook.result.current.deleteResource();
    });
    expect(toastMock.success).toHaveBeenCalledWith("hookify deleted");
    expect(toastMock.error).not.toHaveBeenCalled();
  });
});
