/**
 * The Marketplace page's retry acts, against a fetch fake whose GitHub
 * listing is down for the first read and back for every read after: among
 * all sources the unreadable one is a line whose "Try again" reads it again,
 * and with that source's chip chosen its refusal is the page's whole body,
 * whose own "Try again" does the same. Either way the source's cards appear.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { Stigmer } from "@stigmer/client";
import { PluginQueryController } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/query_pb";
import { GetServerInfoOutputSchema, PlatformQueryController } from "@stigmer/apis/ai/stigmer/platform/v1/server_info_pb";
import { PluginListSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/io_pb";
import { GrantQueryController } from "@stigmer/apis/ai/stigmer/iam/grant/v1/query_pb";

import { StigmerContext } from "@stigmer/react-core";
import { MarketplaceCatalog } from "../MarketplaceCatalog.js";
import { resetGitHubListingCache } from "../sources/github.js";
import type { FetchImpl } from "../sources/types.js";
import { MARKETPLACES_STORAGE_KEY } from "../useMarketplaces.js";
import { HOSTED_MARKETPLACE_NAME, HOSTED_REPO, hostedFetch } from "./fixtures/hosted-marketplace.js";

const ORG = "acme";

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem(MARKETPLACES_STORAGE_KEY, JSON.stringify({ [HOSTED_MARKETPLACE_NAME]: { type: "github", repo: HOSTED_REPO } }));
});

afterEach(() => {
  cleanup();
  resetGitHubListingCache();
});

function transport() {
  return createRouterTransport(({ service }) => {
    service(GrantQueryController, {
      checkMyPermission: (input) => ({ isAuthorized: input.relation === "can_create_plugin" }),
    });
    service(PlatformQueryController, {
      getServerInfo: () => create(GetServerInfoOutputSchema, { edition: 1, version: "dev" }),
    });
    service(PluginQueryController, {
      list: () => create(PluginListSchema, { entries: [], nextPageToken: "" }),
      getByReference: () => {
        throw new ConnectError("no plugin", Code.NotFound);
      },
    });
  });
}

/** The hosted fake, its GitHub listing down until the first listing has been refused. */
function listingDownOnce(): FetchImpl {
  const down = hostedFetch(undefined, { listingStatus: 503 }).fetchImpl;
  const up = hostedFetch().fetchImpl;
  let refused = false;
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (!refused && url.startsWith("https://api.github.com/")) {
      refused = true;
      return down(input, init);
    }
    return up(input, init);
  };
}

function renderCatalog() {
  const client = new Stigmer({ baseUrl: "/", getAccessToken: () => "t", customTransport: transport() });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>
  );
  return render(<MarketplaceCatalog org={ORG} fetchImpl={listingDownOnce()} />, { wrapper });
}

describe("MarketplaceCatalog: reading a source again", () => {
  it("among all sources, the unreadable source's Try again reads it again and its cards appear", async () => {
    renderCatalog();

    const button = await screen.findByRole("button", { name: `Try again to load ${HOSTED_MARKETPLACE_NAME}` });
    expect(screen.queryByRole("button", { name: "Install thermos" })).toBeNull();

    fireEvent.click(button);

    expect(await screen.findByRole("button", { name: "Install thermos" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: `Try again to load ${HOSTED_MARKETPLACE_NAME}` })).toBeNull();
  });

  it("with the source chosen, its whole-page refusal's Try again reads it again and its cards appear", async () => {
    renderCatalog();
    await screen.findByRole("button", { name: `Try again to load ${HOSTED_MARKETPLACE_NAME}` });

    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Sources" })).getByRole("radio", { name: HOSTED_MARKETPLACE_NAME }));
    const refusal = screen.getByText(`Couldn't load ${HOSTED_MARKETPLACE_NAME}.`).closest("[role=alert]") as HTMLElement;
    expect(refusal).toBeTruthy();

    fireEvent.click(within(refusal).getByRole("button", { name: /Try again/ }));

    expect(await screen.findByRole("button", { name: "Install thermos" })).toBeTruthy();
    await waitFor(() => expect(screen.queryByText(`Couldn't load ${HOSTED_MARKETPLACE_NAME}.`)).toBeNull());
  });
});
