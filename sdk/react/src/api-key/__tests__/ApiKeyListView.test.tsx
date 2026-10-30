/**
 * ApiKeyListView's revoke confirmation: Delete asks first, Cancel backs
 * out without revoking, and a confirmed delete revokes the key and tells
 * the list's owner to read it again. The generated client is a fake
 * behind the one provider seam.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import type { Stigmer } from "@stigmer/client";
import { ApiKeySchema } from "@stigmer/apis/ai/stigmer/iam/apikey/v1/api_pb";
import { StigmerContext } from "@stigmer/react-core";
import { ApiKeyListView } from "../ApiKeyListPanel";

const PAGER = { hasMore: false, loadMore: () => {}, isLoadingMore: false, loadMoreError: null, isRefetching: false };

afterEach(cleanup);

describe("ApiKeyListView", () => {
  it("backs out of a revoke on Cancel, and re-reads the list after a confirmed one", async () => {
    const remove = vi.fn(async () => ({}));
    const onDeleted = vi.fn();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StigmerContext.Provider value={{ apiKey: { delete: remove } } as unknown as Stigmer}>{children}</StigmerContext.Provider>
    );
    render(
      <ApiKeyListView
        apiKeys={[create(ApiKeySchema, { metadata: { id: "key_1", name: "ci" } })]}
        isLoading={false}
        error={null}
        onDeleted={onDeleted}
        emptyText="No keys."
        pager={PAGER}
        now={new Date("2026-10-14T00:00:00Z")}
      />,
      { wrapper },
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete ci" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(remove).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete ci" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
