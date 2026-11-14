/**
 * The suite's title holds CON-10 on the UX bar (test/ux-bar.json): the
 * console hands over what puts an agent in the builder's own app, for their
 * stack, with their organization and agent filled in, makes what the route
 * needs in place, and says when their app's first user arrives. Pinned on
 * the agent page (`AgentDetailView` with `inApp`) over a client that answers
 * as the server does:
 * - the tab is offered after Overview, for any agent, only with the host's
 *   opt-in;
 * - on a server that signs people in: the stack picker (remembered in this
 *   browser, and working when storage is blocked) changes the route, whose
 *   text names the organization by its slug and the agent; "Make it" makes
 *   `app-backend` as an admin (the next name when that one is taken) and
 *   shows its key once; the switch turns account creation on as Member and
 *   keeps the origins and vaults; a role that cannot chat is offered
 *   Member; row 5 asks again on a timer only while it waits, and ticks with
 *   the first app user's name; a failed read says so in its row while the
 *   others still work;
 * - a person the server refuses gets no act, and is told who can (CON-01);
 * - on a server that trusts every caller: the development chat, and no
 *   service account, switch or first-user row.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { IdentityAccountProvisioningMode } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/enum_pb";
import { IamRole } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";
import { OrganizationEmbeddingSchema } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/spec_pb";
import type { Organization } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import { StigmerError } from "@stigmer/client";
import { samples } from "@stigmer/react-core/test";
import { AgentDetailView, type AgentDetailViewProps } from "../../agent/AgentDetailView";
import { ACME_ID, orgWrapper } from "../../organization/__tests__/org-fixture";
import { APP_STACK_STORAGE_KEY } from "../rememberedStack";
import { FIRST_APP_USER_POLL_MS } from "../InAppTab";
import type { InAppLinks } from "../InAppTab";

vi.mock("../../feedback/toast", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
  };
});
beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const LINKS: InAppLinks = { serviceAccounts: "/settings/service-accounts", embedding: "/settings/org-embedding" };

interface Entry {
  readonly id: string;
  readonly name: string;
  readonly mode: IdentityAccountProvisioningMode;
  readonly role?: string;
}

interface Options {
  /** Whether the server signs its callers in. */
  readonly signsIn?: boolean;
  /** The permissions the viewer holds; every one by default. */
  readonly refuse?: readonly string[];
  readonly embedding?: { createAccountsOnSignIn: boolean; signInRole: IamRole; allowedOrigins?: string[] };
  readonly access?: Entry[];
  /** Names the server already holds. */
  readonly taken?: readonly string[];
  readonly accessFails?: boolean;
  /** The server refuses to make a service account. */
  readonly createRefused?: boolean;
  /** The server-info read fails this many times before it answers. */
  readonly serverInfoFailures?: number;
  /** Another admin changes the origins right after this person's save. */
  readonly otherAdminAfterSave?: boolean;
  /** The organization read fails. */
  readonly orgFails?: boolean;
  /** Key creation fails this many times before it succeeds. */
  readonly keyFailures?: number;
  /** The client's address, when not Cloud's. */
  readonly baseUrl?: string;
}

function renderPage(props: Partial<AgentDetailViewProps> = {}, opts: Options = {}) {
  const agent = samples.agent({ name: "Variance Reporter", org: ACME_ID });
  agent.metadata!.slug = "variance-reporter";
  const state = {
    access: [...(opts.access ?? [])],
    embedding: create(OrganizationEmbeddingSchema, {
      createAccountsOnSignIn: opts.embedding?.createAccountsOnSignIn ?? false,
      signInRole: opts.embedding?.signInRole ?? IamRole.iam_role_unspecified,
      allowedOrigins: opts.embedding?.allowedOrigins ?? [],
      vaults: [{ org: ACME_ID, slug: "shared-keys", id: "vlt_1" }],
    }),
  };
  const organization = (): Organization =>
    ({ metadata: { id: ACME_ID, slug: "acme", name: "Acme" }, spec: { embedding: state.embedding } }) as unknown as Organization;
  const createServiceAccount = vi.fn(async (input: { org: string; name: string; role: IamRole }) => {
    if (opts.createRefused) throw new StigmerError("permission-denied", "you may not make service accounts here", Code.PermissionDenied);
    if (opts.taken?.includes(input.name)) {
      throw new StigmerError("already-exists", `a service account named '${input.name}' already exists in this organization`, Code.AlreadyExists);
    }
    state.access.push({ id: `ida_${input.name}`, name: input.name, mode: IdentityAccountProvisioningMode.service_account, role: "admin" });
    return { metadata: { id: `ida_${input.name}`, name: input.name } };
  });
  let keyFailures = opts.keyFailures ?? 0;
  const createForServiceAccount = vi.fn(async (input: { serviceAccountId: string; name: string }) => {
    if (keyFailures > 0) {
      keyFailures -= 1;
      throw new StigmerError("unavailable", "the key store is down", Code.Unavailable);
    }
    return { metadata: { name: input.name }, spec: { keyHash: "stk_live_secret" } };
  });
  const updateEmbedding = vi.fn(async (input: { orgId: string; embedding: typeof state.embedding }) => {
    state.embedding = input.embedding;
    const answer = organization();
    if (opts.otherAdminAfterSave) state.embedding = create(OrganizationEmbeddingSchema, { ...input.embedding, allowedOrigins: ["https://other.acme.example"] });
    return answer;
  });
  let serverInfoFailures = opts.serverInfoFailures ?? 0;
  const listResourceAccessByPrincipal = vi.fn(async () => {
    if (opts.accessFails) throw new StigmerError("unavailable", "the access store is down", Code.Unavailable);
    return {
      entries: [
        ...state.access.map((entry) => ({
          principal: { kind: "identity_account", id: entry.id, name: entry.name, email: "", identityOrigin: { provisioningMode: entry.mode } },
          roles: entry.role ? [{ role: { code: entry.role }, isInherited: false }] : [],
        })),
        // A grant whose principal the server could not resolve: never counted.
        { roles: [{ role: { code: "member" }, isInherited: false }] },
      ],
    };
  });
  const refused = new Set(opts.refuse ?? []);
  render(<AgentDetailView org="acme" slug="variance-reporter" inApp={LINKS} {...props} />, {
    wrapper: orgWrapper(
      {
        baseUrl: opts.baseUrl ?? "https://api.stigmer.ai",
        agent: {
          getByReference: vi.fn(async () => agent),
          listVersions: vi.fn(async () => ({ entries: [], nextPageToken: "" })),
        },
        organization: {
          get: vi.fn(async () => {
            if (opts.orgFails) throw new StigmerError("unavailable", "the organization store is down", Code.Unavailable);
            return organization();
          }),
          updateEmbedding,
        },
        identityAccount: { createServiceAccount },
        apiKey: { createForServiceAccount },
        platform: {
          getServerInfo: vi.fn(async () => {
            if (serverInfoFailures > 0) {
              serverInfoFailures -= 1;
              throw new StigmerError("unavailable", "the server is restarting", Code.Unavailable);
            }
            return { singleOrg: false, authenticationRequired: opts.signsIn ?? true, version: "0.1.3" };
          }),
        },
        environment: { list: vi.fn(async () => ({ entries: [], nextPageToken: "" })) },
        grant: {
          checkMyPermission: vi.fn(async (input: { relation: string }) => ({ isAuthorized: !refused.has(input.relation) })),
          listResourceAccessByPrincipal,
        },
        plugin: { get: vi.fn(async () => null) },
      },
      undefined,
      true,
    ),
  });
  return { state, createServiceAccount, createForServiceAccount, updateEmbedding, listResourceAccessByPrincipal };
}

async function openTab(): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole("tab", { name: "In your app" }));
  return screen.findByRole("heading", { name: "Put Variance Reporter in your app" }).then((heading) => heading.parentElement!.parentElement!);
}

/** The row whose title is `title`. */
async function row(title: string): Promise<HTMLElement> {
  const label = await screen.findByText(title, { selector: "p" });
  return label.closest("li")!;
}

describe("CON-10 the console hands over what puts an agent in the builder's own app, for their stack, with their organization and agent filled in, makes what the route needs in place, and says when their app's first user arrives", () => {
  it("offers the tab after Overview, only with the host's opt-in", async () => {
    renderPage();
    const list = await screen.findByRole("tablist", { name: "Agent detail sections" });
    await waitFor(() => expect(within(list).getAllByRole("tab").map((tab) => tab.textContent?.replace(/\d+$/, "")).slice(0, 3)).toEqual(["Overview", "In your app", "Channels"]));
    cleanup();

    renderPage({ inApp: undefined });
    await screen.findByRole("tab", { name: "Overview" });
    expect(screen.queryByRole("tab", { name: "In your app" })).toBeNull();
  });

  it("writes the route for the picked stack with the organization's slug and the agent, and remembers the stack", async () => {
    renderPage({ defaultTab: "in-app" });
    await screen.findByRole("heading", { name: "Put Variance Reporter in your app" });

    const route = await row("Add a token route to your backend");
    expect(within(route).getByText("app/api/stigmer-token/route.ts")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Python" }));
    expect(within(route).getByText("stigmer_token.py")).toBeTruthy();
    expect(within(route).getByText("pip install stigmer-sdk")).toBeTruthy();
    const code = within(route).getByRole("region", { name: "stigmer_token.py" }).textContent ?? "";
    expect(code).toContain('ORG = "acme"');
    expect(code).toContain('base_url="api.stigmer.ai:443"');
    expect(window.localStorage.getItem(APP_STACK_STORAGE_KEY)).toBe("python");

    const chat = await row("Show the chat in your app");
    expect(within(chat).getByRole("region", { name: "StigmerAgentChat.tsx" }).textContent).toContain('agent={"acme/variance-reporter"}');
    cleanup();

    // A later visit opens on the remembered stack.
    renderPage({ defaultTab: "in-app" });
    expect((await screen.findByRole("radio", { name: "Python" })).getAttribute("aria-checked")).toBe("true");
  });

  it("works with storage blocked: the first stack, and a pick that holds for the visit", async () => {
    window.localStorage.setItem(APP_STACK_STORAGE_KEY, "java");
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("blocked");
    });
    renderPage({ defaultTab: "in-app" });
    expect((await screen.findByRole("radio", { name: "Next.js" })).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "Go" }));
    expect(screen.getByRole("radio", { name: "Go" }).getAttribute("aria-checked")).toBe("true");
  });

  it("makes the backend's service account as an admin, takes the next name when one is taken, and shows its key once", async () => {
    const { createServiceAccount, createForServiceAccount } = renderPage({ defaultTab: "in-app" }, { taken: ["app-backend"] });
    const account = await row("A service account for your backend");

    fireEvent.click(await within(account).findByRole("button", { name: "Make it" }));

    const alert = await within(account).findByRole("alert");
    expect(alert.textContent).toContain("stk_live_secret");
    expect(createServiceAccount.mock.calls.map((call) => [call[0].name, call[0].role])).toEqual([
      ["app-backend", IamRole.admin],
      ["app-backend-2", IamRole.admin],
    ]);
    expect(createForServiceAccount.mock.calls[0]?.[0]).toMatchObject({ serviceAccountId: "ida_app-backend-2", name: "app-backend-2", neverExpires: true });
    expect(within(account).getByText(/One key serves every agent in your app/)).toBeTruthy();

    // Dismissed, the key is gone for good.
    fireEvent.click(within(account).getByRole("button", { name: "Dismiss" }));
    expect(within(account).queryByText(/stk_live_secret/)).toBeNull();
    expect(within(account).getByText(/app-backend-2 is made/)).toBeTruthy();
  });

  it("says the account wasn't made, in the server's words, when the server refuses it", async () => {
    const { createServiceAccount } = renderPage({ defaultTab: "in-app" }, { createRefused: true });
    const account = await row("A service account for your backend");
    fireEvent.click(await within(account).findByRole("button", { name: "Make it" }));

    expect(await within(account).findByText(/^The service account wasn't made\. .*may not make service accounts.*[.!?] Try again\.$/)).toBeTruthy();
    expect(createServiceAccount).toHaveBeenCalledTimes(1);
  });

  it("says so when every name it tries is taken", async () => {
    const taken = ["app-backend", ...Array.from({ length: 9 }, (_, n) => `app-backend-${n + 2}`)];
    const { createServiceAccount, createForServiceAccount } = renderPage({ defaultTab: "in-app" }, { taken });
    const account = await row("A service account for your backend");
    fireEvent.click(await within(account).findByRole("button", { name: "Make it" }));

    expect(await within(account).findByText(/Every name from app-backend to app-backend-10 is taken/)).toBeTruthy();
    expect(createServiceAccount).toHaveBeenCalledTimes(10);
    expect(createForServiceAccount).not.toHaveBeenCalled();
  });

  it("when the key fails after the account is made, says so and makes only the key on retry", async () => {
    const { createServiceAccount, createForServiceAccount } = renderPage({ defaultTab: "in-app" }, { keyFailures: 1 });
    const account = await row("A service account for your backend");
    fireEvent.click(await within(account).findByRole("button", { name: "Make it" }));

    expect(await within(account).findByText(/^app-backend was made, but its key wasn't\. .*key store is down.*[.!?] Try again\.$/)).toBeTruthy();
    fireEvent.click(within(account).getByRole("button", { name: "Make its key" }));
    expect(await within(account).findByText(/stk_live_secret/)).toBeTruthy();
    expect(createServiceAccount).toHaveBeenCalledTimes(1);
    expect(createForServiceAccount).toHaveBeenCalledTimes(2);
  });

  it("names an admin service account the organization already has, and offers another", async () => {
    renderPage(
      { defaultTab: "in-app" },
      { access: [{ id: "ida_rb", name: "report-backend", mode: IdentityAccountProvisioningMode.service_account, role: "admin" }, { id: "ida_ci", name: "ci", mode: IdentityAccountProvisioningMode.service_account, role: "member" }] },
    );
    const account = await row("A service account for your backend");
    await waitFor(() => expect(within(account).getByText("report-backend")).toBeTruthy());
    expect(within(account).queryByText(/\bci\b/)).toBeNull();
    expect(within(account).getByRole("button", { name: "Make another" })).toBeTruthy();
    expect(within(account).getByRole("link", { name: "Service accounts" }).getAttribute("href")).toBe("/settings/service-accounts");
  });

  it("turns account creation on as Member, keeping the origins and vaults", async () => {
    const { updateEmbedding } = renderPage({ defaultTab: "in-app" }, { embedding: { createAccountsOnSignIn: false, signInRole: IamRole.iam_role_unspecified, allowedOrigins: ["https://app.acme.example"] } });
    const embedding = await row("Your users get accounts the first time your app signs them in");

    fireEvent.click(await within(embedding).findByRole("switch"));

    await waitFor(() => expect(updateEmbedding).toHaveBeenCalledTimes(1));
    const saved = updateEmbedding.mock.calls[0]![0];
    expect(saved.orgId).toBe(ACME_ID);
    expect(saved.embedding).toMatchObject({ createAccountsOnSignIn: true, signInRole: IamRole.member, allowedOrigins: ["https://app.acme.example"] });
    expect(saved.embedding.vaults.map((ref: { slug: string }) => ref.slug)).toEqual(["shared-keys"]);
    await within(embedding).findByText(/they join as Member, from https:\/\/app\.acme\.example/);
  });

  it("says a setting that wasn't saved, in the server's words, and what to do", async () => {
    const { updateEmbedding } = renderPage({ defaultTab: "in-app" }, { embedding: { createAccountsOnSignIn: false, signInRole: IamRole.iam_role_unspecified } });
    updateEmbedding.mockRejectedValueOnce(new ConnectError("The settings store is down", Code.Unavailable));
    const embedding = await row("Your users get accounts the first time your app signs them in");
    fireEvent.click(await within(embedding).findByRole("switch"));
    expect((await within(embedding).findByRole("alert")).textContent).toBe("The setting wasn't saved. The settings store is down. Try again.");
  });

  it("shows a newer read of the organization over its own saved answer", async () => {
    renderPage({ defaultTab: "in-app" }, { otherAdminAfterSave: true });
    const embedding = await row("Your users get accounts the first time your app signs them in");
    fireEvent.click(await within(embedding).findByRole("switch"));
    expect(await within(embedding).findByText(/from https:\/\/other\.acme\.example/)).toBeTruthy();
  });

  it("offers Member when accounts are made with a role that cannot chat", async () => {
    const { updateEmbedding } = renderPage({ defaultTab: "in-app" }, { embedding: { createAccountsOnSignIn: true, signInRole: IamRole.iam_role_unspecified } });
    const embedding = await row("Your users get accounts the first time your app signs them in");
    expect(await within(embedding).findByText(/couldn't chat/)).toBeTruthy();

    // The button waits on the edit check, which may answer after the row's words.
    fireEvent.click(await within(embedding).findByRole("button", { name: "Let them chat as Member" }));
    await waitFor(() => expect(updateEmbedding.mock.calls[0]?.[0].embedding).toMatchObject({ createAccountsOnSignIn: true, signInRole: IamRole.member }));
  });

  it("CON-01 tells a person the server refuses who makes the account and turns sign-in on, with no act", async () => {
    renderPage({ defaultTab: "in-app" }, { refuse: ["can_create_identity_account", "can_edit"] });
    const account = await row("A service account for your backend");
    expect(await within(account).findByText("An admin of this organization makes the service account.")).toBeTruthy();
    expect(within(account).queryByRole("button")).toBeNull();
    const embedding = await row("Your users get accounts the first time your app signs them in");
    expect(await within(embedding).findByText("An admin of this organization turns this on.")).toBeTruthy();
    expect(within(embedding).queryByRole("switch")).toBeNull();
  });

  it("CON-01 tells a person refused the access list who sees who signs in", async () => {
    const { listResourceAccessByPrincipal } = renderPage({ defaultTab: "in-app" }, { refuse: ["can_view_access"] });
    const first = await row("Your first user from your app");
    expect(await within(first).findByText("An admin of this organization sees who signs in.")).toBeTruthy();
    expect(listResourceAccessByPrincipal).not.toHaveBeenCalled();
  });

  it("says the tab couldn't be read when the organization read fails", async () => {
    renderPage({ defaultTab: "in-app" }, { orgFails: true });
    expect(await screen.findByText("Stigmer couldn't load the code for your app")).toBeTruthy();
  });

  it("asks the server again when its first answer failed", async () => {
    renderPage({ defaultTab: "in-app" }, { serverInfoFailures: 1 });
    fireEvent.click(await screen.findByRole("button", { name: /try again/i }));
    expect(await screen.findByRole("radio", { name: "Next.js" })).toBeTruthy();
  });

  it("says it can't show the code when the server's public address is unknown", async () => {
    renderPage({ defaultTab: "in-app" }, { baseUrl: "/" });
    expect(await screen.findByText(/can't show the code for your app/)).toBeTruthy();
    expect(screen.queryByRole("radio", { name: "Node" })).toBeNull();
  });

  it("asks again on a timer only while waiting for the first app user, then ticks with their name and stops", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { state, listResourceAccessByPrincipal } = renderPage({ defaultTab: "in-app" });
    const first = await row("Your first user from your app");
    expect(await within(first).findByText(/Waiting for the first person your app signs in/)).toBeTruthy();
    const before = listResourceAccessByPrincipal.mock.calls.length;

    state.access.push({ id: "ida_dana", name: "Dana Lee", mode: IdentityAccountProvisioningMode.app_user, role: "member" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FIRST_APP_USER_POLL_MS + 10);
    });

    expect(await within(first).findByText("Dana Lee")).toBeTruthy();
    expect(within(first).getByText(/signed in from your app/)).toBeTruthy();
    expect(listResourceAccessByPrincipal.mock.calls.length).toBeGreaterThan(before);
    const after = listResourceAccessByPrincipal.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FIRST_APP_USER_POLL_MS * 3);
    });
    expect(listResourceAccessByPrincipal.mock.calls.length).toBe(after);
  });

  it("says in its row when who signed in cannot be read, and the code still shows", async () => {
    renderPage({ defaultTab: "in-app" }, { accessFails: true });
    const first = await row("Your first user from your app");
    expect((await within(first).findByRole("alert")).textContent).toMatch(/^Stigmer couldn't say who has signed in\. .*[.!?] Try again$/);
    expect(within(first).getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(within(await row("Add a token route to your backend")).getByRole("region", { name: "app/api/stigmer-token/route.ts" })).toBeTruthy();
  });

  it("points at a chat link's Embed tab for a public helper, in one line that opens Channels", async () => {
    renderPage({ defaultTab: "in-app" });
    await openTab();
    expect(screen.getByText(/Visitors can't attach files/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open Channels" }));
    expect(screen.getByRole("tab", { name: "Channels" }).getAttribute("aria-selected")).toBe("true");
  });

  it("on a server that trusts every caller, hands over the development chat and no account, switch or first-user row", async () => {
    const { listResourceAccessByPrincipal } = renderPage({ defaultTab: "in-app" }, { signsIn: false });
    await screen.findByRole("heading", { name: "Put Variance Reporter in your app" });

    expect(await screen.findByText(/trusts every caller, so your app talks to it with no sign-in/)).toBeTruthy();
    expect(screen.getByRole("region", { name: "StigmerAgentChat.tsx" }).textContent).toContain("getAccessToken: () => null");
    expect(screen.getByRole("link", { name: "your own server with sign-in turned on" }).getAttribute("href")).toContain("/docs/guides/self-hosting/authentication");
    expect(screen.queryByText("A service account for your backend")).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByText("Your first user from your app")).toBeNull();
    expect(listResourceAccessByPrincipal).not.toHaveBeenCalled();
  });
});
