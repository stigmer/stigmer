/**
 * The settings sweep: every settings page opens the same way, and shows
 * that it is reading while it reads and that it has finished once it has.
 *
 * The pages are found, not listed: every `*Section` the settings module
 * exports (each a page of the console's settings, `client-apps/web` routing
 * one per URL), plus the platform operator's three consoles. A section added
 * to the module is swept without anyone naming it here; the web console's
 * routing test closes the loop from the other side, checking that each
 * settings link's page renders one of these.
 *
 * Each page is drawn over a real client whose transport is a router with
 * one interceptor, under the provider and an `OrgProvider`, as the console
 * draws it. Both postures answer the person's organizations with one, so
 * every page has an active organization (none would draw "No organization
 * selected" and prove nothing):
 *   - waiting: every other call stays unanswered. A page that asked for
 *     anything past what the providers ask for shows a busy region
 *     (`aria-busy`); a page that reads nothing from the server shows none;
 *   - answered: every unary call is answered with its method's empty output
 *     (`create(method.output)`, so no service is listed here), every
 *     self-check says yes, on Stigmer Cloud, where every page is offered.
 *     The page settles: nothing busy, nothing in `role="alert"`, and its
 *     body (its rows or its empty state) under the heading.
 * In both, the page has exactly one page heading: the settings frame's h2.
 *
 * A section whose props have a required one takes it from REQUIRED_PROPS,
 * keyed by export name; its type makes the typecheck refuse a section added
 * with a required prop and no entry, and the first case refuses an entry
 * for a section the module no longer exports.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  Code,
  ConnectError,
  createRouterTransport,
  type Interceptor,
  type UnaryRequest,
  type UnaryResponse,
} from "@connectrpc/connect";
import type { ComponentProps, ComponentType } from "react";
import { Stigmer, type DeploymentMode } from "@stigmer/client";
import { samples } from "@stigmer/react-core/test";
import { GrantQueryController } from "@stigmer/apis/ai/stigmer/iam/grant/v1/query_pb";
import { OrganizationQueryController } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/query_pb";
import { StigmerProvider } from "../../provider";
import { OrgProvider } from "../../organization/OrgProvider";
import { LicensesConsole } from "../../licenses/LicensesConsole";
import { ModelCatalogConsole } from "../../model-catalog/ModelCatalogConsole";
import { PlanCatalogConsole } from "../../plan-catalog/PlanCatalogConsole";
import * as settings from "../index";

type Settings = typeof settings;
type SectionName = Extract<keyof Settings, `${string}Section`>;

/** The sections whose props have a required one: a section is here exactly when the typecheck says it must be. */
type RequiredPropsMap = {
  readonly [K in SectionName as Record<string, never> extends ComponentProps<Settings[K]> ? never : K]: ComponentProps<
    Settings[K]
  >;
};

const REQUIRED_PROPS: RequiredPropsMap = {
  NotificationsSection: { requestPermission: async () => false },
};

/** A page the sweep draws: its export name and its component. */
type Page = readonly [name: string, component: ComponentType<Record<string, unknown>>];

const SECTIONS: readonly Page[] = Object.entries(settings)
  .filter(([name, value]) => name.endsWith("Section") && typeof value === "function")
  .map(([name, value]) => [name, value as ComponentType<Record<string, unknown>>] as const);

const CONSOLES: readonly Page[] = [
  ["LicensesConsole", LicensesConsole as ComponentType<Record<string, unknown>>],
  ["PlanCatalogConsole", PlanCatalogConsole as ComponentType<Record<string, unknown>>],
  ["ModelCatalogConsole", ModelCatalogConsole as ComponentType<Record<string, unknown>>],
];

const PAGES: readonly Page[] = [...SECTIONS, ...CONSOLES];

const ORGANIZATION = samples.organization();

/** A unary call's answer, without the call ever reaching the router. */
function answer(request: UnaryRequest, message: UnaryResponse["message"]): UnaryResponse {
  return {
    stream: false,
    service: request.service,
    method: request.method,
    header: new Headers(),
    trailer: new Headers(),
    message,
  };
}

/** Whether the call is the person's organization list, which both postures answer. */
function isOrganizationList(request: { readonly method: unknown }): boolean {
  return request.method === OrganizationQueryController.method.listMine;
}

/** How a client answers: nothing past the organizations, everything, or everything after each read's first failure. */
type Posture = "waiting" | "answered" | "failing-once";

/**
 * A client in one posture, recording the name of every call it is asked.
 * Waiting: only the organization list is answered. Answered: every unary
 * call is answered with its empty output, every self-check yes. Failing
 * once: as answered, except that each other call fails the first time it is
 * asked, as a server that is briefly unavailable does.
 */
function clientIn(posture: Posture, asked: Set<string>): Stigmer {
  const failed = new Set<string>();
  const interceptor: Interceptor = () => async (request) => {
    const call = `${request.service.typeName}/${request.method.name}`;
    asked.add(call);
    if (posture === "waiting" || request.stream) {
      return isOrganizationList(request) && !request.stream
        ? answer(request, samples.organizationList([ORGANIZATION]))
        : new Promise<never>(() => {});
    }
    if (isOrganizationList(request)) {
      return answer(request, samples.organizationList([ORGANIZATION]));
    }
    if (request.method === GrantQueryController.method.checkMyPermission) {
      return answer(request, create(request.method.output, { isAuthorized: true }));
    }
    if (posture === "failing-once" && !failed.has(call)) {
      failed.add(call);
      throw new ConnectError("the server is briefly unavailable", Code.Unavailable);
    }
    return answer(request, create(request.method.output));
  };
  const registry: typeof globalThis.fetch = (input) => {
    asked.add(`fetch ${String(input)}`);
    return posture === "waiting"
      ? new Promise<never>(() => {})
      : Promise.resolve(new Response(JSON.stringify({ models: [] }), { headers: { "content-type": "application/json" } }));
  };
  return new Stigmer({
    baseUrl: "https://sweep.invalid",
    apiKey: "stk_sweep",
    customTransport: createRouterTransport(() => {}, { transport: { interceptors: [interceptor] } }),
    fetch: registry,
  });
}

function draw(page: Page, posture: Posture, asked: Set<string>, mode: DeploymentMode = "cloud") {
  const [name, Component] = page;
  const props: object = (REQUIRED_PROPS as Partial<Record<string, object>>)[name] ?? {};
  return render(
    <StigmerProvider client={clientIn(posture, asked)} deploymentMode={mode}>
      <OrgProvider>
        <Component {...props} />
      </OrgProvider>
    </StigmerProvider>,
  );
}

/** The page's one heading, once the organization is active and the page drawn for it. */
async function pageHeading(): Promise<HTMLElement> {
  await waitFor(() => expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(1));
  await waitFor(() => expect(screen.queryByText("No organization selected")).toBeNull());
  return screen.getByRole("heading", { level: 2 });
}

/** The calls the providers make with no page under them: what a page that reads nothing still sees asked. */
const PROVIDER_CALLS = new Set<string>();

beforeAll(async () => {
  render(
    <StigmerProvider client={clientIn("waiting", PROVIDER_CALLS)} deploymentMode="cloud">
      <OrgProvider>
        <p>No page</p>
      </OrgProvider>
    </StigmerProvider>,
  );
  await screen.findByText("No page");
  // Let the providers' effects ask what they ask on mount.
  await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
  cleanup();
});

afterEach(cleanup);

describe("CON-04 every settings page shares one frame, and shows its loading and its settled state", () => {
  it("sweeps every section the settings module exports, and the three operator consoles", () => {
    expect(SECTIONS.length).toBeGreaterThanOrEqual(19);
    for (const name of Object.keys(REQUIRED_PROPS)) {
      expect(SECTIONS.map(([section]) => section), `REQUIRED_PROPS names ${name}, which is not exported`).toContain(name);
    }
  });

  it.each(PAGES)("%s shows one page heading and a busy region while its reads are unanswered", async (...page) => {
    const asked = new Set<string>();
    const { container } = draw(page, "waiting", asked);
    const heading = await pageHeading();
    const region = heading.closest("section");
    expect(region?.getAttribute("aria-labelledby")).toBe(heading.id);
    // Let the page's own effects ask what they ask.
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(screen.queryByText("No organization selected")).toBeNull();
    const ownCalls = [...asked].filter((call) => !PROVIDER_CALLS.has(call));
    const busy = container.querySelectorAll("[aria-busy='true']");
    if (ownCalls.length > 0) {
      expect(busy.length, `${page[0]} asked ${ownCalls.join(", ")} and shows nothing busy`).toBeGreaterThan(0);
    } else {
      expect(busy.length, `${page[0]} reads nothing, yet shows a busy region`).toBe(0);
    }
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(1);
  });

  it.each(PAGES)("%s settles with every call answered: nothing busy, no alert, its body under one heading", async (...page) => {
    const asked = new Set<string>();
    const { container } = draw(page, "answered", asked);
    const heading = await pageHeading();
    await waitFor(() => expect(container.querySelectorAll("[aria-busy='true']")).toHaveLength(0), { timeout: 3000 });
    expect(screen.queryAllByRole("alert").map((alert) => alert.textContent)).toEqual([]);
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(1);
    const region = heading.closest("section") as HTMLElement;
    // The frame's header, then the page's body: its rows, its form or its empty state.
    expect(region.children.length, `${page[0]} drew nothing under its heading`).toBeGreaterThan(1);
    expect(within(region).queryByText(/^Only an admin can open/)).toBeNull();
  });
});

describe("CON-04 a settings page whose read fails says so, and Try again reads it again", () => {
  it.each(PAGES)("%s recovers from a server that fails each read once", async (...page) => {
    const asked = new Set<string>();
    const { container } = draw(page, "failing-once", asked);
    await pageHeading();
    const seen: string[] = [];
    // Each Try again may lead to the next read (the billing account, then its
    // plan), which fails once in turn; the page settles once none is left.
    for (let round = 0; round < 5; round += 1) {
      await waitFor(() => expect(container.querySelectorAll("[aria-busy='true']")).toHaveLength(0), { timeout: 3000 });
      await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
      const alerts = screen.queryAllByRole("alert");
      if (alerts.length === 0) break;
      for (const alert of alerts) {
        seen.push(alert.textContent ?? "");
        fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
      }
    }
    expect(screen.queryAllByRole("alert").map((alert) => alert.textContent)).toEqual([]);
    const ownCalls = [...asked].filter((call) => !PROVIDER_CALLS.has(call));
    if (ownCalls.length > 0) {
      expect(seen.length, `${page[0]} read ${ownCalls.join(", ")} and never said a read failed`).toBeGreaterThan(0);
    }
  });
});

/**
 * The pages whose header offers no act: forms that save in place, figures,
 * and pages whose acts sit in their rows. A page that gains a header act
 * leaves this list; one that loses its act fails below instead of passing
 * unnoticed.
 */
const NO_MAIN_ACT: ReadonlySet<string> = new Set([
  "BillingSection",
  "MembersSection",
  "OrgProfileSection",
  "OrgPreferencesSection",
  "OrgPoliciesSection",
  "OrgEmbeddingSection",
  "AccountPreferencesSection",
  "NotificationsSection",
  "MemorySection",
  "InvitationsSection",
  "AccessHistorySection",
  "UsageSection",
  "LicensesConsole",
]);

/** The acts in a settled page's header. */
async function headerActs(page: Page) {
  const { container } = draw(page, "answered", new Set());
  const heading = await pageHeading();
  await waitFor(() => expect(container.querySelectorAll("[aria-busy='true']")).toHaveLength(0), { timeout: 3000 });
  const header = heading.closest("header") as HTMLElement;
  return { header, acts: within(header).queryAllByRole("button") };
}

describe("CON-04 a settings page's main act opens its form in the page, and Cancel returns to it", () => {
  it.each(PAGES.filter((page) => !NO_MAIN_ACT.has(page[0])))("%s", async (...page) => {
    const { header, acts } = await headerActs(page);
    expect(acts.length, `${page[0]} offers no main act in its header`).toBeGreaterThan(0);
    const [mainAct] = acts;
    const name = mainAct.textContent ?? "";
    fireEvent.click(mainAct);
    const cancel = await screen.findByRole("button", { name: "Cancel" });
    expect(within(header).queryByRole("button", { name })).toBeNull();
    fireEvent.click(cancel);
    expect(await within(header).findByRole("button", { name })).toBeTruthy();
  });

  it.each(PAGES.filter((page) => NO_MAIN_ACT.has(page[0])))("%s offers no act in its header", async (...page) => {
    const { acts } = await headerActs(page);
    expect(acts).toEqual([]);
  });
});
