/**
 * Pins how the console learns that its server holds one organization
 * (`useSingleOrg`, server-info.ts) and what the sidebar does with it:
 *
 *   - while the server's answer loads, the hook says nothing (undefined) and
 *     the sidebar shows no switcher, so a laptop never sees one flash;
 *   - a server that holds one organization keeps the switcher hidden;
 *   - a server that holds several, and one that fails to answer (an older
 *     server, a network fault), show the switcher as they always have.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { createRouterTransport } from "@connectrpc/connect";
import type { ConnectRouter } from "@connectrpc/connect";
import { Stigmer } from "@stigmer/sdk";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import {
  GetServerInfoOutputSchema,
  PlatformQueryController,
  ServerEdition,
} from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationsSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/io_pb";
import { OrganizationQueryController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/query_pb";
import { StigmerContext } from "../../context";
import { OrgProvider } from "../../organization/OrgProvider";
import { useSingleOrg } from "../../server-info";
import { SidebarChrome } from "../chrome";

beforeAll(() => {
  // happy-dom lacks ResizeObserver, which Base UI positioners observe.
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
  }
});

afterEach(cleanup);

/** The server's answer: one organization, several, or no platform service at all (it fails). */
type Server = "single" | "several" | "fails";

/** A promise the platform answer waits on, so a test can observe the loading state. */
function gate() {
  let open: () => void = () => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

function renderWith(server: Server, ui: React.ReactNode, answer = Promise.resolve()) {
  const client = new Stigmer({
    baseUrl: "/",
    getAccessToken: () => "test-token",
    customTransport: createRouterTransport((router: ConnectRouter) => {
      router.service(OrganizationQueryController, {
        findMyOrganizations: () =>
          create(OrganizationsSchema, {
            entries: [
              create(OrganizationSchema, {
                metadata: create(ApiResourceMetadataSchema, {
                  id: "stigmer",
                  slug: "stigmer",
                  name: "Stigmer",
                }),
              }),
            ],
          }),
      });
      if (server !== "fails") {
        router.service(PlatformQueryController, {
          getServerInfo: async () => {
            await answer;
            return create(GetServerInfoOutputSchema, {
              edition: ServerEdition.oss,
              version: "dev",
              authenticationRequired: false,
              singleOrg: server === "single",
            });
          },
        });
      }
    }),
  });
  return render(
    <StigmerContext.Provider value={client}>
      <OrgProvider>{ui}</OrgProvider>
    </StigmerContext.Provider>,
  );
}

function SingleOrgProbe() {
  const singleOrg = useSingleOrg();
  return <span data-testid="single-org">{String(singleOrg)}</span>;
}

const chrome = (
  <SidebarChrome ariaLabel="Workspace" isOpen onCollapse={() => {}} footer={null}>
    <SingleOrgProbe />
  </SidebarChrome>
);

describe("useSingleOrg and the sidebar's switcher", () => {
  it("says nothing and shows no switcher while the answer loads, then hides it on a one-organization server", async () => {
    const answer = gate();
    renderWith("single", chrome, answer.opened);

    expect(screen.getByTestId("single-org").textContent).toBe("undefined");
    expect(screen.queryByRole("button", { name: "Organization menu" })).toBeNull();

    answer.open();
    await waitFor(() =>
      expect(screen.getByTestId("single-org").textContent).toBe("true"),
    );
    expect(screen.queryByRole("button", { name: "Organization menu" })).toBeNull();
  });

  it("shows the switcher on a server that holds several", async () => {
    renderWith("several", chrome);
    await waitFor(() =>
      expect(screen.getByTestId("single-org").textContent).toBe("false"),
    );
    expect(await screen.findByRole("button", { name: "Organization menu" })).toBeTruthy();
  });

  it("shows the switcher when the server does not answer", async () => {
    renderWith("fails", chrome);
    await waitFor(() =>
      expect(screen.getByTestId("single-org").textContent).toBe("false"),
    );
    expect(await screen.findByRole("button", { name: "Organization menu" })).toBeTruthy();
  });
});
