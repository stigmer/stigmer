/**
 * Pins AccessHistorySection's postures and its reading of the history.
 *
 *   - on open source, which keeps no history, the section says so and asks
 *     the server nothing;
 *   - on Stigmer Cloud, where the organization's plan lacks the history,
 *     the plan notice names the plan that includes it and nothing is read;
 *   - a caller the server refuses `can_view_access_history` on the
 *     organization's id reads who reads the history, and no history
 *     request is sent;
 *   - an allowed caller reads the changes newest first, each a sentence
 *     naming who did what for whom on what, the server shown acting for
 *     a person and a deleted resource shown deleted; "Load more" follows
 *     the page token;
 *   - "Download JSON Lines" follows the whole history oldest first and
 *     downloads one line per entry;
 *   - one line above the rows says how long the server keeps the history,
 *     from the first page: "Kept for good" when it removes nothing.
 *
 * Everything below the network is real but the plan hooks and the file
 * download: the organization provider, the permission gate, the list hook
 * and the export, over a router transport that records what the server was
 * asked.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { ErrorInfoSchema } from "@stigmer/protos/google/rpc/error_details_pb";
import { Stigmer, type DeploymentMode } from "@stigmer/sdk";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import {
  AccessChange,
  AccessChangeCause,
  AccessHistoryEntrySchema,
  AccessHistoryPageSchema,
  CheckAuthorizationResultSchema,
  type CheckMyPermissionInput,
  type ListAccessHistoryInput,
} from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import { IamPolicyQueryController } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/query_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationsSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/io_pb";
import { OrganizationQueryController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/query_pb";
import { StigmerContext } from "../../context";
import { DeploymentModeContext } from "../../deployment-mode";
import { OrgProvider } from "../../organization/OrgProvider";
import { AccessHistorySection } from "../AccessHistorySection";

const stubs = vi.hoisted(() => ({
  planAllowsHistory: true as boolean | null,
  downloads: [] as Array<{ content: string; filename: string; mimeType: string }>,
}));

vi.mock("../../billing/useEntitlements.js", () => ({
  useEntitlements: (_orgId: string | null, options?: { enabled?: boolean }) => ({
    entitlements: null,
    allows: () => (options?.enabled === false ? null : stubs.planAllowsHistory),
    isLoading: false,
    error: null,
    refetch: () => {},
  }),
}));
vi.mock("../../billing/usePlans.js", async () => {
  const { BUSINESS, TEAM } = await import("../../billing/__tests__/fixtures");
  return {
    usePlans: (options?: { enabled?: boolean }) => ({
      plans: options?.enabled === false ? null : [BUSINESS, TEAM],
      isLoading: false,
      isRefetching: false,
      error: null,
      refetch: () => {},
    }),
  };
});
vi.mock("../../internal/download.js", () => ({
  downloadTextFile: (content: string, filename: string, mimeType: string) => {
    stubs.downloads.push({ content, filename, mimeType });
  },
}));

const ACME = create(OrganizationSchema, {
  metadata: create(ApiResourceMetadataSchema, { id: "org_acme", slug: "acme", name: "Acme" }),
});

const ANA = { kind: "identity_account", id: "ida_ana", name: "Ana Silva", email: "ana@acme.example" };
const RAJ = { kind: "identity_account", id: "ida_raj", name: "Raj Patel", email: "raj@acme.example" };

/** The fields an entry overrides here, as plain init objects. */
interface EntryInit {
  readonly change?: AccessChange;
  readonly cause?: AccessChangeCause;
  readonly actorClass?: string;
  readonly principal?: { kind?: string; id: string; name?: string; email?: string; relation?: string };
  readonly role?: { id?: string; code?: string; name?: string };
  readonly resource?: { org: string; kind: ApiResourceKind; id: string; slug: string } | undefined;
}

function entry(sequence: number, init: EntryInit) {
  return create(AccessHistoryEntrySchema, {
    sequence: BigInt(sequence),
    occurredAt: timestampFromDate(new Date(Date.UTC(2026, 9, sequence))),
    change: AccessChange.granted,
    cause: AccessChangeCause.grant,
    actorClass: "user",
    actor: ANA,
    principal: RAJ,
    role: { id: "member", code: "member", name: "Member" },
    resource: { org: "org_acme", kind: ApiResourceKind.organization, id: "org_acme", slug: "acme" },
    ...init,
  });
}

/** The history newest first, two pages: the first page's token is "t1". */
const NEWEST = [
  entry(5, {
    change: AccessChange.revoked,
    cause: AccessChangeCause.organization_access_revoked,
  }),
  entry(4, {
    role: { id: "editor", code: "editor", name: "Editor" },
    resource: { org: "org_acme", kind: ApiResourceKind.agent, id: "agt_billing", slug: "" },
  }),
];
const OLDER = [
  entry(3, { actorClass: "internal", principal: { kind: "identity_account", id: "ida_bob", name: "Bob Lee" } }),
  entry(2, {
    principal: { kind: "team", id: "tm_core", name: "Core", relation: "member" },
    role: { code: "viewer", name: "Viewer" },
    resource: undefined,
  }),
  entry(1, { cause: AccessChangeCause.organization_created, principal: ANA, role: { code: "owner", name: "Owner" } }),
];

interface Server {
  readonly verdict: boolean;
  readonly checks: CheckMyPermissionInput[];
  readonly reads: ListAccessHistoryInput[];
}

/** How the fake server answers a read: the pages above, a plan refusal, or a failing export. */
type ReadMode = "pages" | "plan-refusal" | "export-fails";

function renderSection(mode: DeploymentMode, verdict = true, read: ReadMode = "pages", retentionDays = 0): Server {
  const server: Server = { verdict, checks: [], reads: [] };
  const client = new Stigmer({
    baseUrl: "/",
    getAccessToken: () => "test-token",
    customTransport: createRouterTransport((router) => {
      router.service(OrganizationQueryController, {
        listMine: () => create(OrganizationsSchema, { entries: [ACME] }),
      });
      router.service(IamPolicyQueryController, {
        checkMyPermission: (input) => {
          server.checks.push(input);
          return create(CheckAuthorizationResultSchema, { isAuthorized: server.verdict });
        },
        listAccessHistory: (input) => {
          server.reads.push(input);
          if (read === "plan-refusal") {
            throw new ConnectError(
              "The access history needs the Enterprise plan.",
              Code.FailedPrecondition,
              undefined,
              [{ desc: ErrorInfoSchema, value: { reason: "PLAN_UPGRADE_REQUIRED", metadata: { feature: "access_history" } } }],
            );
          }
          if (read === "export-fails" && input.afterSequence !== undefined) {
            throw new ConnectError("history unavailable", Code.Unavailable);
          }
          if (input.afterSequence !== undefined) {
            const all = [...NEWEST, ...OLDER].reverse();
            return create(AccessHistoryPageSchema, {
              entries: all.filter((e) => e.sequence > (input.afterSequence ?? BigInt(0))),
            });
          }
          return input.pageToken === ""
            ? create(AccessHistoryPageSchema, { entries: NEWEST, nextPageToken: "t1", oldestSequence: BigInt(1), retentionDays })
            : create(AccessHistoryPageSchema, { entries: OLDER, oldestSequence: BigInt(1), retentionDays });
        },
      });
    }),
  });
  render(
    <StigmerContext.Provider value={client}>
      <DeploymentModeContext.Provider value={mode}>
        <OrgProvider>
          <AccessHistorySection />
        </OrgProvider>
      </DeploymentModeContext.Provider>
    </StigmerContext.Provider>,
  );
  return server;
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  stubs.planAllowsHistory = true;
  stubs.downloads.length = 0;
});

describe("AccessHistorySection", () => {
  it("names the plan when the server refuses the read for it", async () => {
    renderSection("cloud", true, "plan-refusal");
    await waitFor(() => expect(screen.getByText("The access history needs the Enterprise plan.")).toBeTruthy());
    expect(screen.getByRole("link", { name: "View plans" })).toBeTruthy();
  });

  it("says a failed download failed and keeps the history on screen", async () => {
    renderSection("enterprise", true, "export-fails");
    await waitFor(() => expect(screen.getByRole("button", { name: "Download JSON Lines" })).toBeTruthy());
    act(() => {
      screen.getByRole("button", { name: "Download JSON Lines" }).click();
    });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("history unavailable"));
    expect(stubs.downloads).toEqual([]);
    expect(screen.getAllByRole("listitem").length).toBeGreaterThan(0);
  });

  it("says open source keeps no history and asks the server nothing", async () => {
    const server = renderSection("local");
    await settle();
    expect(screen.getByText(/This\s+edition keeps no record of access changes/)).toBeTruthy();
    expect(server.checks).toEqual([]);
    expect(server.reads).toEqual([]);
  });

  it("names the plan on Cloud where the organization's plan lacks the history, and reads nothing", async () => {
    stubs.planAllowsHistory = false;
    const server = renderSection("cloud");
    await settle();
    expect(screen.getByText("Access history is not included in this organization's plan.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "View plans" })).toBeTruthy();
    expect(server.reads).toEqual([]);
  });

  it("tells a caller who may not read it who does, and sends no read", async () => {
    const server = renderSection("enterprise", false);
    await waitFor(() =>
      expect(screen.getByText("The access history is read by your organization's owners and admins.")).toBeTruthy(),
    );
    expect(server.checks.map((check) => [check.resource?.id, check.relation])).toEqual([
      ["org_acme", "can_view_access_history"],
    ]);
    expect(server.reads).toEqual([]);
  });

  it("reads the changes newest first as sentences, and loads older ones", async () => {
    const server = renderSection("enterprise");
    await waitFor(() =>
      expect(screen.getByText("Ana Silva removed Raj Patel's Member role on organization acme")).toBeTruthy(),
    );
    expect(screen.getByText("Ana Silva gave Raj Patel the Editor role on a deleted agent")).toBeTruthy();
    expect(server.reads[0]).toMatchObject({ org: "org_acme", pageToken: "" });

    act(() => {
      screen.getByRole("button", { name: "Load more" }).click();
    });
    await waitFor(() =>
      expect(
        screen.getByText("The server, on behalf of Ana Silva, gave Bob Lee the Member role on organization acme"),
      ).toBeTruthy(),
    );
    expect(server.reads[1]).toMatchObject({ pageToken: "t1" });
    const items = screen.getAllByRole("listitem").map((item) => item.textContent ?? "");
    expect(items.map((text) => text.match(/#(\d+)/)?.[1])).toEqual(["5", "4", "3", "2", "1"]);
    expect(screen.getByText("Ana Silva gave the members of team Core the Viewer role on a resource")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("says above the rows how long the server keeps the history", async () => {
    renderSection("enterprise", true, "pages", 365);
    await waitFor(() => expect(screen.getByText("Entries older than 365 days are removed")).toBeTruthy());
    cleanup();
    renderSection("enterprise");
    await waitFor(() => expect(screen.getByText("Kept for good")).toBeTruthy());
  });

  it("downloads the whole history oldest first, one JSON line per entry", async () => {
    const server = renderSection("enterprise");
    await waitFor(() => expect(screen.getByRole("button", { name: "Download JSON Lines" })).toBeTruthy());
    act(() => {
      screen.getByRole("button", { name: "Download JSON Lines" }).click();
    });
    await waitFor(() => expect(stubs.downloads).toHaveLength(1));
    const [download] = stubs.downloads;
    expect(download?.filename).toBe("access-history-org_acme.jsonl");
    const lines = (download?.content ?? "").trimEnd().split("\n").map((line) => JSON.parse(line) as { sequence: string });
    expect(lines.map((line) => line.sequence)).toEqual(["1", "2", "3", "4", "5"]);
    expect(server.reads.at(-1)).toMatchObject({ afterSequence: BigInt(0), pageSize: 100 });
  });
});
