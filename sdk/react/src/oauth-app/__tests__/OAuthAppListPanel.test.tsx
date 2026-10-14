/**
 * OAuthAppListPanel lists an organization's OAuth apps by provider and
 * hands the host the app a row's Edit names. The data hook is stubbed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { OAuthAppSchema, type OAuthApp } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/api_pb";
import { OAuthAppListPanel } from "../OAuthAppListPanel";

const stubs = vi.hoisted(() => ({ apps: [] as OAuthApp[] }));

vi.mock("../useOAuthAppList.js", () => ({
  useOAuthAppList: () => ({
    oauthApps: stubs.apps,
    hasMore: false,
    loadMore: () => {},
    isLoadingMore: false,
    loadMoreError: null,
    isLoading: false,
    isRefetching: false,
    error: null,
    refetch: () => {},
  }),
}));

afterEach(() => {
  cleanup();
  stubs.apps = [];
});

describe("OAuthAppListPanel", () => {
  it("hands Edit the app its row shows", () => {
    stubs.apps = [create(OAuthAppSchema, { metadata: { id: "oap_1", org: "acme" }, spec: { provider: "github" } })];
    const onEdit = vi.fn();
    render(<OAuthAppListPanel org="acme" onEdit={onEdit} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit github" }));
    expect(onEdit.mock.calls[0]![0].metadata?.id).toBe("oap_1");
  });
});
