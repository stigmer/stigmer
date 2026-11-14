/**
 * The suite's title holds CON-08 on the UX bar (test/ux-bar.json): after
 * the first job, the console leads to making the agent the person's own.
 * Pinned on the agent page (`AgentDetailView` with `makeItYours`) over a
 * client that keeps one stored agent with an etag, as the server does:
 * - the tab is offered first, only with the host's opt-in, only for an
 *   agent the journey made, and only to a person who may edit it; the page
 *   opens on it only when asked;
 * - a change to the instructions saves through the page's own save: it says
 *   a new version was kept, offers a run on the sample, and Overview shows
 *   the change at once, whose next save carries the current etag and is
 *   not refused;
 * - "Try your own file" links the launcher on this agent for the person's
 *   own file;
 * - "Give it a skill" makes "Spreadsheet export" from the shipped SKILL.md
 *   when the organization has none, never pushes over a skill of that name
 *   the organization already has, adds the reference through the page's
 *   save, and tells a person who may not make skills that an admin adds
 *   them, with no button (CON-01).
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { clone, create } from "@bufbuild/protobuf";
import { Code } from "@connectrpc/connect";
import { unzipSync, strFromU8 } from "fflate";
import { AgentSchema, type Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentStatusSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/status_pb";
import { ApiResourceReferenceSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";
import { StigmerError } from "@stigmer/client";
import { SKILLS } from "@stigmer/examples";
import { samples } from "@stigmer/react-core/test";
import { AgentDetailView, type AgentDetailViewProps } from "../../agent/AgentDetailView";
import { ACME_ID, orgWrapper } from "../../organization/__tests__/org-fixture";
import type { MakeItYoursLinks } from "../MakeItYoursTab";

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
afterEach(cleanup);

const INSTRUCTIONS = "Flag each account more than 10% over or under budget.";

const LINKS: MakeItYoursLinks = {
  launch: ({ agent, example, mode }) => `/?agent=${agent.org}/${agent.slug}&example=${example ?? ""}&with=${mode}`,
  putInApp: (agent) => `/agents/${agent.slug}?tab=in-app`,
};

function storedAgent(slug: string): Agent {
  const agent = samples.agent({ name: "Variance Reporter", org: ACME_ID });
  agent.metadata!.slug = slug;
  agent.metadata!.etag = "1";
  agent.spec!.instructions = INSTRUCTIONS;
  return agent;
}

/** A proto field path's spec field, as the generated message names it ("spec.skill_refs" is `skillRefs`). */
function specField(path: string): string {
  return path.replace(/^spec\./, "").replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

interface Options {
  readonly slug?: string;
  readonly canEdit?: boolean;
  readonly canCreateSkill?: boolean;
  readonly skillExists?: boolean;
  readonly hasSkill?: boolean;
  /** Another skill the agent already has, which adding this one keeps. */
  readonly otherSkill?: boolean;
  /** The skill read fails with an error other than not-found. */
  readonly readFails?: boolean;
  /** The skill push is refused. */
  readonly pushFails?: boolean;
  /** The first save of the agent is refused. */
  readonly firstSaveFails?: boolean;
}

function renderPage(props: Partial<AgentDetailViewProps> = {}, opts: Options = {}) {
  const store = { agent: storedAgent(opts.slug ?? "variance-reporter"), versions: 1 };
  if (opts.hasSkill) store.agent.spec!.skillRefs = [create(ApiResourceReferenceSchema, { org: ACME_ID, slug: "spreadsheet-export", id: "skl_1" })];
  if (opts.otherSkill) store.agent.spec!.skillRefs = [create(ApiResourceReferenceSchema, { org: ACME_ID, slug: "ledger-rules", id: "skl_rules", version: "v2" })];
  let saves = 0;
  let pushed = false;
  const update = vi.fn(async (resource: Agent, paths: string[]) => {
    saves += 1;
    if (opts.firstSaveFails && saves === 1) throw new StigmerError("unavailable", "the store is busy", Code.Unavailable);
    if (resource.metadata?.etag !== store.agent.metadata?.etag) {
      throw new StigmerError("aborted", "ETAG_MISMATCH: the agent changed since it was read", Code.Aborted);
    }
    const next = clone(AgentSchema, store.agent);
    for (const path of paths) Reflect.set(next.spec!, specField(path), Reflect.get(resource.spec!, specField(path)));
    next.metadata!.etag = String(Number(store.agent.metadata!.etag) + 1);
    store.versions += 1;
    // A changed spec is a new version, named by its hash.
    const status = next.status ?? create(AgentStatusSchema, {});
    status.versionHash = `h${store.versions}`;
    next.status = status;
    store.agent = next;
    return clone(AgentSchema, next);
  });
  const push = vi.fn(async (_request: { org: string; artifact: Uint8Array }) => {
    if (opts.pushFails) throw new StigmerError("invalid-argument", "SKILL.md is not valid", Code.InvalidArgument);
    pushed = true;
    return { metadata: { id: "skl_new", org: ACME_ID, slug: "spreadsheet-export" } };
  });
  const skillRead = vi.fn(async () => {
    if (opts.readFails) throw new StigmerError("unavailable", "the skill store is down", Code.Unavailable);
    if (pushed) return { metadata: { id: "skl_new", org: ACME_ID, slug: "spreadsheet-export" } };
    if (opts.skillExists) return { metadata: { id: "skl_theirs", org: ACME_ID, slug: "spreadsheet-export" } };
    throw new StigmerError("not-found", "skill not found", Code.NotFound);
  });
  render(<AgentDetailView org="acme" slug={opts.slug ?? "variance-reporter"} editable {...props} />, {
    wrapper: orgWrapper(
      {
        agent: {
          getByReference: vi.fn(async () => clone(AgentSchema, store.agent)),
          update,
          listVersions: vi.fn(async () => ({
            entries: Array.from({ length: store.versions }, (_, n) => ({ versionHash: `h${n}` })),
            nextPageToken: "",
          })),
        },
        skill: { getByReference: skillRead, push },
        platform: { getServerInfo: vi.fn(async () => ({ singleOrg: false })) },
        environment: { list: vi.fn(async () => ({ entries: [], nextPageToken: "" })) },
        grant: {
          checkMyPermission: vi.fn(async (input: { relation: string }) => ({
            isAuthorized:
              (input.relation === "can_edit" && (opts.canEdit ?? true)) || (input.relation === "can_create_skill" && (opts.canCreateSkill ?? true)),
          })),
        },
        plugin: { get: vi.fn(async () => null) },
      },
      undefined,
      true,
    ),
  });
  return { store, update, push, skillRead };
}

async function tabs(): Promise<string[]> {
  const list = await screen.findByRole("tablist", { name: "Agent detail sections" });
  await waitFor(() => expect(within(list).getAllByRole("tab").length).toBeGreaterThan(1));
  return within(list)
    .getAllByRole("tab")
    .map((tab) => tab.textContent?.replace(/\d+$/, "") ?? "");
}

async function openTab(): Promise<HTMLElement> {
  return screen.findByRole("region", { name: "Change what it does" });
}

describe("CON-08 after the first job, the console says what comes next and leads to making the agent theirs: change its instructions, run it on their own file, give it a skill", () => {
  it("offers the tab first, for a journey agent the person may edit, only with the host's opt-in", async () => {
    renderPage({ makeItYours: LINKS });

    await waitFor(async () => expect((await tabs())[0]).toBe("Make it yours"));
    // Opened only when asked: the page opens on Overview.
    expect(screen.getByRole("tab", { name: "Overview" }).getAttribute("aria-selected")).toBe("true");
  });

  it("offers no tab without the host's opt-in, for an agent the journey did not make, or to a reader", async () => {
    const plain = renderPage();
    await screen.findByRole("tab", { name: "Overview" });
    expect(screen.queryByRole("tab", { name: "Make it yours" })).toBeNull();
    expect(plain.skillRead).not.toHaveBeenCalled();
    cleanup();

    renderPage({ makeItYours: LINKS }, { slug: "triage-bot" });
    await screen.findByRole("tab", { name: "Overview" });
    expect(screen.queryByRole("tab", { name: "Make it yours" })).toBeNull();
    cleanup();

    renderPage({ makeItYours: LINKS }, { canEdit: false });
    await screen.findByRole("tab", { name: "Overview" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(screen.queryByRole("tab", { name: "Make it yours" })).toBeNull();
  });

  it("changes the instructions through the page's own save, offers a run on the sample, and Overview shows it with a current etag", async () => {
    const { update, store } = renderPage({ makeItYours: LINKS, defaultTab: "make-it-yours" });
    const card = await openTab();

    fireEvent.click(await within(card).findByRole("button", { name: INSTRUCTIONS }));
    fireEvent.change(within(card).getByPlaceholderText("Add instructions for the agent"), {
      target: { value: INSTRUCTIONS.replace("10%", "5%") },
    });
    fireEvent.click(within(card).getByRole("button", { name: "Save" }));

    expect(await within(card).findByText("Saved as a new version.")).toBeTruthy();
    expect(within(card).getByRole("link", { name: "Run it on the sample" }).getAttribute("href")).toBe(
      `/?agent=${ACME_ID}/variance-reporter&example=variance-report&with=sample`,
    );
    expect(store.agent.spec?.instructions).toContain("5%");
    // The new version shows in the Versions tab's count at once.
    await waitFor(() => expect(screen.getByRole("tab", { name: /Versions/ }).textContent).toBe("Versions2"));

    // Overview reads the same copy: the change is there, and its next save is not refused.
    fireEvent.click(screen.getByRole("tab", { name: /Overview/ }));
    const changed = INSTRUCTIONS.replace("10%", "5%");
    fireEvent.click(await screen.findByRole("button", { name: changed }));
    fireEvent.change(screen.getByPlaceholderText("Add instructions for the agent"), { target: { value: `${changed} Be brief.` } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("button", { name: `${changed} Be brief.` });
    expect(update).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/ETAG_MISMATCH/)).toBeNull();
  });

  it("links a run on the person's own file through the launcher", async () => {
    renderPage({ makeItYours: LINKS, defaultTab: "make-it-yours" });
    const card = await screen.findByRole("region", { name: "Try your own file" });

    expect(within(card).getByRole("link", { name: "Choose a file" }).getAttribute("href")).toBe(
      `/?agent=${ACME_ID}/variance-reporter&example=variance-report&with=own`,
    );
  });

  it("gives it the skill, made from the shipped SKILL.md when the organization has none", async () => {
    const { push, update, store } = renderPage({ makeItYours: LINKS, defaultTab: "make-it-yours" });
    const card = await screen.findByRole("region", { name: "Give it a skill" });

    const add = await within(card).findByRole("button", { name: "Add it" });
    await waitFor(() => expect((add as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(add);

    expect(await within(card).findByText(/is on\. Its runs hand back a \.csv beside the report\./)).toBeTruthy();
    expect(push).toHaveBeenCalledTimes(1);
    const sent = push.mock.calls[0]![0];
    expect(sent.org).toBe(ACME_ID);
    const files = unzipSync(sent.artifact);
    expect(Object.keys(files)).toEqual(["SKILL.md"]);
    expect(strFromU8(files["SKILL.md"]!)).toBe(SKILLS.find((skill) => skill.id === "spreadsheet-export")?.text);
    expect(update.mock.calls.at(-1)?.[1]).toEqual(["spec.skill_refs"]);
    expect(store.agent.spec?.skillRefs.map((ref) => ref.slug)).toEqual(["spreadsheet-export"]);
  });

  it("uses the organization's own skill of that name as it is, never pushing over it", async () => {
    const { push, store } = renderPage({ makeItYours: LINKS, defaultTab: "make-it-yours" }, { skillExists: true, canCreateSkill: false });
    const card = await screen.findByRole("region", { name: "Give it a skill" });

    const add = await within(card).findByRole("button", { name: "Add it" });
    await waitFor(() => expect((add as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(add);

    await within(card).findByText(/is on\./);
    expect(push).not.toHaveBeenCalled();
    expect(store.agent.spec?.skillRefs.map((ref) => ref.slug)).toEqual(["spreadsheet-export"]);
  });

  it("CON-01 tells a person who may not make skills that an admin adds them, with no button", async () => {
    const { push } = renderPage({ makeItYours: LINKS, defaultTab: "make-it-yours" }, { canCreateSkill: false });
    const card = await screen.findByRole("region", { name: "Give it a skill" });

    expect(await within(card).findByText("An admin of this organization adds skills.")).toBeTruthy();
    expect(within(card).queryByRole("button", { name: "Add it" })).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });

  it("says the skill is on once the agent has it, and reads nothing more", async () => {
    const { skillRead } = renderPage({ makeItYours: LINKS, defaultTab: "make-it-yours" }, { hasSkill: true });
    const card = await screen.findByRole("region", { name: "Give it a skill" });

    expect(within(card).getByText(/is on\./)).toBeTruthy();
    expect(within(card).getByRole("link", { name: "Run it on the sample" })).toBeTruthy();
    expect(skillRead).not.toHaveBeenCalled();
  });

  it("keeps the agent's other skills, as stored, when it adds this one", async () => {
    const { update } = renderPage({ makeItYours: LINKS, defaultTab: "make-it-yours" }, { otherSkill: true });
    const card = await screen.findByRole("region", { name: "Give it a skill" });
    const add = await within(card).findByRole("button", { name: "Add it" });
    await waitFor(() => expect((add as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(add);

    await within(card).findByText(/is on\./);
    const sent = update.mock.calls.at(-1)![0].spec!.skillRefs.map((ref) => ({ id: ref.id, slug: ref.slug, version: ref.version }));
    expect(sent).toEqual([
      { id: "skl_rules", slug: "", version: "v2" },
      { id: "", slug: "spreadsheet-export", version: "" },
    ]);
  });

  it("says a push the server refused, in its words, and leaves the agent as it was", async () => {
    const { update } = renderPage({ makeItYours: LINKS, defaultTab: "make-it-yours" }, { pushFails: true });
    const card = await screen.findByRole("region", { name: "Give it a skill" });
    const add = await within(card).findByRole("button", { name: "Add it" });
    await waitFor(() => expect((add as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(add);

    // What happened, the server's sentence, then what to do.
    expect((await within(card).findByRole("alert")).textContent).toMatch(/^Spreadsheet export wasn't added\. SKILL\.md is not valid.*[.!?] Try again\.$/);
    expect(update).not.toHaveBeenCalled();
  });

  it("never pushes twice: a retry after the agent's save failed adds the skill the first click made", async () => {
    const { push, store } = renderPage({ makeItYours: LINKS, defaultTab: "make-it-yours" }, { firstSaveFails: true });
    const card = await screen.findByRole("region", { name: "Give it a skill" });
    const add = await within(card).findByRole("button", { name: "Add it" });
    await waitFor(() => expect((add as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(add);
    expect((await within(card).findByRole("alert")).textContent).toMatch(/^Spreadsheet export wasn't added\. .*the store is busy.*[.!?] Try again\.$/);

    await waitFor(() => expect((within(card).getByRole("button", { name: "Add it" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(within(card).getByRole("button", { name: "Add it" }));
    await within(card).findByText(/is on\./);
    expect(push).toHaveBeenCalledTimes(1);
    expect(store.agent.spec?.skillRefs.map((ref) => ref.slug)).toEqual(["spreadsheet-export"]);
  });

  it("says a skill read that failed, and offers no add it could not judge", async () => {
    renderPage({ makeItYours: LINKS, defaultTab: "make-it-yours" }, { readFails: true });
    const card = await screen.findByRole("region", { name: "Give it a skill" });

    expect((await within(card).findByRole("alert")).textContent).toMatch(
      /^Stigmer couldn't check whether Spreadsheet export is in this organization\. .*the skill store is down.*[.!?] Reload the page to try again\.$/,
    );
    expect((within(card).getByRole("button", { name: "Add it" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("opens the Versions tab from the line that says every save is kept there", async () => {
    renderPage({ makeItYours: LINKS, defaultTab: "make-it-yours" });
    const card = await openTab();
    fireEvent.click(within(card).getByRole("button", { name: "Versions" }));

    await waitFor(() => expect(screen.getByRole("tab", { name: /Versions/ }).getAttribute("aria-selected")).toBe("true"));
  });

  it("leads to the next step: putting the agent where its users are", async () => {
    renderPage({ makeItYours: LINKS, defaultTab: "make-it-yours" });
    await openTab();

    expect(screen.getByRole("link", { name: "Put it in your app" }).getAttribute("href")).toBe("/agents/variance-reporter?tab=in-app");
  });
});
