// Unit tests of `get`'s designed views (CLI-09): the registry sweep (every
// kind `get` serves has a view or is named generic, never both), the
// renderer (empty fields and sections left out, wrapping at a width and
// none piped, wide characters measured by their columns, bold and dim only
// when styled), the shared words (references, spans, tokens, the
// instructions cut, schedules in words), each view's branches, `hideOrg`
// on every view, the generic view's Created and Updated, `renderGet`'s
// dispatch, and that `get` loads the views lazily. Inputs are the fixed
// protos in views/__fixtures__; nothing reads the clock.

import { readFileSync } from "node:fs";
import { create, type DescMessage, type Message } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { EnvironmentSchema } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/api_pb";
import { NetworkingType } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/spec_pb";
import { RoutineSchema } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { EnvironmentSource } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { SkillSchema } from "@stigmer/apis/ai/stigmer/agentic/skill/v1/api_pb";
import { VaultSchema } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { OrganizationSchema } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import type { Stigmer } from "@stigmer/client";
import { describe, expect, it } from "vitest";
import { protoToJsonValue, styler } from "../../../output/index.js";
import { defaultRegistry, Verb } from "../../../registry/index.js";
import { asObject, instant, type JsonObject, renderResource } from "../../render.js";
import * as fixtures from "../__fixtures__/resources.js";
import { GENERIC_VIEW_KINDS, renderGet, terminalWidth, VIEWS } from "../index.js";
import { withoutFrontmatter } from "../skill.js";
import { type KindView, renderView, type ViewContext, wrapText } from "../view.js";
import { firstLines, objects, phaseWord, refLabel, refLabels, runSpan, scheduleWords, strings, tokenUsage } from "../words.js";

const PLAIN: ViewContext = { hideOrg: false, orgLabel: "acme", style: styler(false), now: fixtures.FROZEN };

function json(schema: DescMessage, message: Message): JsonObject {
  return asObject(protoToJsonValue(schema, message));
}

function runJson(run: Message): JsonObject {
  return json(RunSchema, run);
}

/** `kind`'s view of `message`, plain, with `ctx` over acme's defaults. */
function draw(kind: ApiResourceKind, schema: DescMessage, message: Message, ctx: Partial<ViewContext> = {}): string {
  return renderView(VIEWS.get(kind)!, json(schema, message), { ...PLAIN, ...ctx });
}

const ALL: ReadonlyArray<[name: string, kind: ApiResourceKind, schema: DescMessage, message: Message]> = [
  ["agent", ApiResourceKind.agent, AgentSchema, fixtures.agent],
  ["skill", ApiResourceKind.skill, SkillSchema, fixtures.skill],
  ["session", ApiResourceKind.session, SessionSchema, fixtures.session],
  ["run", ApiResourceKind.run, RunSchema, fixtures.failedRun],
  ["organization", ApiResourceKind.organization, OrganizationSchema, fixtures.organization],
  ["routine", ApiResourceKind.routine, RoutineSchema, fixtures.routine],
  ["environment", ApiResourceKind.environment, EnvironmentSchema, fixtures.environment],
];

describe("CLI-09 the registry sweep: every kind get serves has a view or is named generic", () => {
  // `get run` is served outside the registry (the run alias), so it joins the registry's Get kinds by hand.
  const served = new Set([...defaultRegistry().typesForVerb(Verb.Get).map((info) => info.kind), ApiResourceKind.run]);

  it("gives every kind get serves a designed view or names it generic", () => {
    for (const kind of served) {
      expect(VIEWS.has(kind) || GENERIC_VIEW_KINDS.has(kind), `${ApiResourceKind[kind]} has no view and is not named generic`).toBe(true);
    }
  });

  it("names no kind both designed and generic, and none get does not serve", () => {
    for (const kind of [...VIEWS.keys(), ...GENERIC_VIEW_KINDS]) {
      expect(served.has(kind), `${ApiResourceKind[kind]} is not served by get`).toBe(true);
      expect(VIEWS.has(kind) && GENERIC_VIEW_KINDS.has(kind), ApiResourceKind[kind]).toBe(false);
    }
  });
});

describe("CLI-09 the view renderer", () => {
  const view: KindView = {
    sections: () => [
      { fields: [["Empty", ""], ["Missing", undefined], ["Kept", "yes"]] },
      { title: "Nothing", fields: [["Empty", ""]], rows: [], lines: [], more: "… never shown" },
      { title: "Rows", rows: [["a", "first"], ["longer", "second"]], more: "… 2 more" },
      { title: "Text", lines: ["plain", "  indented", "  - item"] },
    ],
  };
  const resource: JsonObject = { metadata: { name: "Thing", slug: "thing", org: "org_1" } };

  it("leaves out a field with no value and a section with nothing in it, its note included", () => {
    expect(renderView(view, resource, PLAIN)).toBe(
      [
        "",
        "Thing  acme/thing",
        "",
        "  Kept:  yes",
        "",
        "Rows",
        "  a       first",
        "  longer  second",
        "  … 2 more",
        "",
        "Text",
        "  plain",
        "    indented",
        "    - item",
        "",
      ].join("\n"),
    );
  });

  it("titles a resource by its slug, then its id, when it has no name, and names the organization as given without a label", () => {
    const titled = (metadata: JsonObject, ctx: Partial<ViewContext> = {}) =>
      renderView({ sections: () => [] }, { metadata }, { ...PLAIN, ...ctx }).split("\n")[1];
    expect(titled({ slug: "s", org: "org_1" }, { orgLabel: undefined })).toBe("s  org_1/s");
    expect(titled({ id: "x_1" }, { orgLabel: undefined })).toBe("x_1");
    expect(titled({ id: "x_1", org: "org_1" }, { hideOrg: true })).toBe("x_1");
  });

  it("draws the title and headings bold and the location and notes dim when styled, and nothing else", () => {
    const out = renderView(view, resource, { ...PLAIN, style: styler(true) });
    expect(out).toContain("\x1b[1mThing\x1b[0m  \x1b[2macme/thing\x1b[0m");
    expect(out).toContain("\x1b[1mRows\x1b[0m");
    expect(out).toContain("  \x1b[2m… 2 more\x1b[0m");
    expect(out).toContain("  Kept:  yes\n");
    expect(out).not.toMatch(/\x1b\[3\dm/);
  });

  it("wraps a field's value under itself at the width, and a list item under its text", () => {
    const long: KindView = {
      sections: () => [
        { fields: [["Description", "one two three four five six seven eight nine ten"]] },
        { title: "Text", lines: ["- alpha beta gamma delta epsilon zeta eta theta"], rows: [["k", "aa bb cc dd ee ff gg hh ii jj"]] },
      ],
    };
    expect(renderView(long, resource, { ...PLAIN, width: 40 })).toBe(
      [
        "",
        "Thing  acme/thing",
        "",
        "  Description:  one two three four five",
        "                six seven eight nine ten",
        "",
        "Text",
        "  k  aa bb cc dd ee ff gg hh ii jj",
        "  - alpha beta gamma delta epsilon zeta",
        "    eta theta",
        "",
      ].join("\n"),
    );
  });

  it("hangs a wrapped row's last column under itself, and text under its indent or its list marker", () => {
    const text: KindView = {
      sections: () => [
        { rows: [["key", "aa bb cc dd ee ff gg hh"], ["k2"], []] },
        {
          title: "Text",
          lines: [
            "    an indented block of text that wraps",
            "- unindented item that wraps here",
            "10. a numbered item that wraps here",
            "-   wide marker item that wraps",
            "a line - with a dash that wraps here",
          ],
        },
      ],
    };
    // 25 columns leave less than the 20-column floor beside the longer prefixes.
    expect(renderView(text, resource, { ...PLAIN, width: 25 })).toBe(
      [
        "",
        "Thing  acme/thing",
        "",
        "  key  aa bb cc dd ee ff gg",
        "       hh",
        "  k2",
        "",
        "",
        "Text",
        "      an indented block of",
        "      text that wraps",
        "  - unindented item that",
        "    wraps here",
        "  10. a numbered item that",
        "      wraps here",
        "  -   wide marker item",
        "      that wraps",
        "  a line - with a dash",
        "  that wraps here",
        "",
      ].join("\n"),
    );
  });

  it("wraps nothing piped, and keeps a field's own line breaks", () => {
    const multi: KindView = { sections: () => [{ fields: [["Note", `first line\n${"word ".repeat(40).trim()}`]] }] };
    const out = renderView(multi, resource, PLAIN);
    expect(out).toContain(`  Note:  first line\n         ${"word ".repeat(40).trim()}\n`);
  });

  it("wrapText breaks at spaces within the room, keeps a word wider than the room whole, and measures wide characters by their columns", () => {
    expect(wrapText("short", 10)).toEqual(["short"]);
    expect(wrapText("aaa bbb ccc", 7)).toEqual(["aaa bbb", "ccc"]);
    expect(wrapText("aaa https://example.com/a/very/long/path bbb", 10)).toEqual(["aaa", "https://example.com/a/very/long/path", "bbb"]);
    expect(wrapText("https://example.com/a/very/long/path bbb", 10)).toEqual(["https://example.com/a/very/long/path", "bbb"]);
    expect(wrapText("exactly10!", 10)).toEqual(["exactly10!"]);
    expect(wrapText("aaa bbb ccc", undefined)).toEqual(["aaa bbb ccc"]);
    // Each of these characters takes two columns: four of them fill eight.
    expect(wrapText("日本語で 書いた 文", 8)).toEqual(["日本語で", "書いた", "文"]);
  });

  it("keeps at least 20 columns of room on a narrow terminal", () => {
    const narrow: KindView = { sections: () => [{ fields: [["A very long label", "one two three four five six"]] }] };
    const lines = renderView(narrow, resource, { ...PLAIN, width: 10 }).split("\n");
    expect(lines).toContain("  A very long label:  one two three four");
  });
});

describe("CLI-09 the shared words", () => {
  it("cuts a long text at 12 lines and says how many more and how to read them", () => {
    const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n");
    expect(firstLines(lines(12))).toEqual({ lines: lines(12).split("\n") });
    expect(firstLines(lines(13))).toEqual({ lines: lines(12).split("\n"), more: "… 1 more line; -o yaml for all" });
    expect(firstLines(lines(52)).more).toBe("… 40 more lines; -o yaml for all");
    expect(firstLines("a\r\nb\n\n\n")).toEqual({ lines: ["a", "b"] });
    expect(firstLines("  \n\n")).toEqual({ lines: [] });
    expect(firstLines("x\ny\nz", 2)).toEqual({ lines: ["x", "y"], more: "… 1 more line; -o yaml for all" });
  });

  it("names a reference by org/slug, its own organization by the label, a pin after @", () => {
    const own = { org: "org_1" };
    const ctx = { ...PLAIN, orgLabel: "acme" };
    expect(refLabel({ org: "org_1", slug: "a" }, own, ctx)).toBe("acme/a");
    expect(refLabel({ org: "other", slug: "a" }, own, ctx)).toBe("other/a");
    expect(refLabel({ org: "org_1", slug: "a" }, own, { ...ctx, orgLabel: undefined })).toBe("org_1/a");
    expect(refLabel({ org: "org_1", slug: "a" }, own, { ...ctx, hideOrg: true })).toBe("a");
    expect(refLabel({ slug: "a" }, own, ctx)).toBe("a");
    expect(refLabel({ org: "org_1", id: "agt_1" }, own, ctx)).toBe("acme/agt_1");
    expect(refLabel({ org: "org_1", slug: "a", version: "latest" }, own, ctx)).toBe("acme/a");
    expect(refLabel({ org: "org_1", slug: "a", version: "v2" }, own, ctx)).toBe("acme/a@v2");
    expect(refLabel({ org: "org_1", slug: "a", version: "b".repeat(64) }, own, ctx)).toBe(`acme/a@${"b".repeat(12)}`);
    expect(refLabel({ org: "org_1", slug: "a", version: `v${"b".repeat(64)}` }, own, ctx)).toBe(`acme/a@v${"b".repeat(64)}`);
    expect(refLabel({ org: "org_1", slug: "a", version: `${"b".repeat(64)}x` }, own, ctx)).toBe(`acme/a@${"b".repeat(64)}x`);
    expect(refLabel({ org: "org_1" }, own, ctx)).toBe("");
    expect(refLabels([{ org: "org_1" }, { org: "org_1", slug: "a" }], own, ctx)).toEqual(["acme/a"]);
  });

  it("reads only the objects and strings of a protojson list, and none of anything else", () => {
    expect(objects([{ a: 1 }, "x", null, [1], 2])).toEqual([{ a: 1 }]);
    expect(objects("x")).toEqual([]);
    expect(objects(undefined)).toEqual([]);
    expect(strings(["a", 1, null, "b"])).toEqual(["a", "b"]);
    expect(strings("ab")).toEqual([]);
    expect(asObject("x")).toEqual({});
    expect(asObject(null)).toEqual({});
    expect(asObject([1])).toEqual({});
  });

  it("dates a run's span: ended, working so far, not started, ended with no end", () => {
    const run = (phase: RunPhase, startedAt: string, completedAt = "") =>
      runJson(create(RunSchema, { status: { phase, startedAt, completedAt } }));
    expect(runSpan(run(RunPhase.RUN_COMPLETED, fixtures.at(-2), fixtures.at(-1)), fixtures.FROZEN)).toBe("1m 0s");
    expect(runSpan(run(RunPhase.RUN_IN_PROGRESS, fixtures.at(-125)), fixtures.FROZEN)).toBe("2h 5m so far");
    expect(runSpan(run(RunPhase.RUN_PENDING, ""), fixtures.FROZEN)).toBeUndefined();
    expect(runSpan(run(RunPhase.RUN_CANCELLED, fixtures.at(-2)), fixtures.FROZEN)).toBeUndefined();
  });

  it("words a run's status from its protojson phase", () => {
    expect(phaseWord(runJson(create(RunSchema, { status: { phase: RunPhase.RUN_WAITING_FOR_APPROVAL } })))).toBe("awaiting-approval");
    expect(phaseWord({ status: { phase: "RUN_SOMETHING_NEW" } })).toBe("unknown");
    expect(phaseWord({})).toBe("unknown");
  });

  it("counts a run's tokens, never a price, and none when it counted none", () => {
    expect(tokenUsage(runJson(fixtures.failedRun))).toBe("18.4k (12.4k in, 6.0k out)");
    expect(tokenUsage({ status: { streaming_usage: { total_tokens: "900", input_tokens: 600, output_tokens: "300" } } })).toBe(
      "900 (600 in, 300 out)",
    );
    expect(tokenUsage({ status: { streaming_usage: { total_tokens: "x" } } })).toBeUndefined();
    expect(tokenUsage({ status: { streaming_usage: { total_tokens: true } } })).toBeUndefined();
    expect(tokenUsage({})).toBeUndefined();
  });

  it.each([
    [undefined, "", "only when fired"],
    ["@hourly", "UTC", "every hour, on the hour, UTC"],
    ["@daily", "", "every day at 00:00, UTC"],
    ["@weekly", "UTC", "every Sunday at 00:00, UTC"],
    ["@monthly", "UTC", "on day 1 of every month at 00:00, UTC"],
    ["@yearly", "UTC", "every year on January 1 at 00:00, UTC"],
    ["15 * * * *", "UTC", "every hour at minute 15, UTC"],
    ["0 9 * * *", "Asia/Kolkata", "every day at 09:00, Asia/Kolkata"],
    ["  30   7 * *   * ", "UTC", "every day at 07:30, UTC"],
    ["5 18 1 * *", "UTC", "on day 1 of every month at 18:05, UTC"],
    ["0 9 * * 1", "UTC", "every Monday at 09:00, UTC"],
    ["0 9 * * 5,1,3", "UTC", "every Monday, Wednesday and Friday at 09:00, UTC"],
    ["0 9 * * 1,2,3,4,5", "UTC", "every weekday at 09:00, UTC"],
    ["0 9 * * 0,1,2,3,4,5,6", "UTC", "every day at 09:00, UTC"],
    ["0 9 * * 0,6", "UTC", "every Sunday and Saturday at 09:00, UTC"],
    ["*/5 * * * *", "UTC", 'cron "*/5 * * * *", UTC'],
    ["0 9 * 1 *", "UTC", 'cron "0 9 * 1 *", UTC'],
    ["60 9 * * *", "UTC", 'cron "60 9 * * *", UTC'],
    ["0 24 * * *", "UTC", 'cron "0 24 * * *", UTC'],
    ["0 * * * 1", "UTC", 'cron "0 * * * 1", UTC'],
    ["0 9 0 * *", "UTC", 'cron "0 9 0 * *", UTC'],
    ["0 9 32 * *", "UTC", 'cron "0 9 32 * *", UTC'],
    ["0 9 1 * 1", "UTC", 'cron "0 9 1 * 1", UTC'],
    ["0 9 * * MON", "UTC", 'cron "0 9 * * MON", UTC'],
    ["0 9 * * 1-5", "UTC", 'cron "0 9 * * 1-5", UTC'],
    ["0 9 * * 7", "UTC", 'cron "0 9 * * 7", UTC'],
    ["0 9 * * * *", "UTC", 'cron "0 9 * * * *", UTC'],
    ["0 9 * *", "UTC", 'cron "0 9 * *", UTC'],
    ["0 * 1 * *", "UTC", 'cron "0 * 1 * *", UTC'],
    ["1e1 9 * * *", "UTC", 'cron "1e1 9 * * *", UTC'],
    ["005 9 * * *", "UTC", 'cron "005 9 * * *", UTC'],
    ["59 23 31 * *", "UTC", "on day 31 of every month at 23:59, UTC"],
    ["0 9 * * 7,1", "UTC", 'cron "0 9 * * 7,1", UTC'],
    ["0 9 * * 1,7", "UTC", 'cron "0 9 * * 1,7", UTC'],
  ])("words the schedule %j in %j as %j", (cron, zone, words) => {
    expect(scheduleWords(cron, zone)).toBe(words);
  });

  it("drops SKILL.md's frontmatter, and keeps a text with none or with an unclosed one", () => {
    expect(withoutFrontmatter("---\nname: a\n---\n\n# A\nbody")).toBe("# A\nbody");
    expect(withoutFrontmatter("---\r\nname: a\r\n---\r\nbody")).toBe("body");
    expect(withoutFrontmatter("# A\nbody")).toBe("# A\nbody");
    expect(withoutFrontmatter("---\nname: a\nbody")).toBe("---\nname: a\nbody");
    expect(withoutFrontmatter("---\nname: a\n---")).toBe("");
    expect(withoutFrontmatter("---\nname: a\n---\n\n\n# A\n\nbody")).toBe("# A\n\nbody");
    // A rule further down is not frontmatter.
    expect(withoutFrontmatter("# A\n\n---\n\nmore")).toBe("# A\n\n---\n\nmore");
  });
});

describe("CLI-09 each view keeps the organization out on a server that holds one (hideOrg)", () => {
  it.each(ALL)("the %s view names no organization", (_name, kind, schema, message) => {
    const runs = fixtures.sessionRuns.map(runJson);
    const out = draw(kind, schema, message, { hideOrg: true, orgLabel: undefined, runs });
    // No reference reads acme/…; an address such as a git remote may.
    expect(out).not.toMatch(/(^|\s)acme\//m);
    // An organization's own id is its ID line, not a location.
    if (kind !== ApiResourceKind.organization) expect(out).not.toContain(fixtures.ACME_ID);
    expect(out.split("\n")[1]).not.toMatch(/\//);
  });

  it("names it by its label on a server that holds several", () => {
    expect(draw(ApiResourceKind.agent, AgentSchema, fixtures.agent).split("\n")[1]).toBe("Variance Reporter  acme/variance-reporter");
    expect(draw(ApiResourceKind.run, RunSchema, fixtures.failedRun).split("\n")[1]).toBe("run_01jfffffffffffffffffffffff  acme");
    expect(draw(ApiResourceKind.organization, OrganizationSchema, fixtures.organization).split("\n")[1]).toBe("Acme Robotics  acme");
  });
});

describe("CLI-09 the views leave out what a resource does not carry", () => {
  const bare = (kind: ApiResourceKind, metadata: JsonObject) => renderView(VIEWS.get(kind)!, { metadata }, PLAIN);

  it("draws a bare agent as its title alone", () => {
    expect(bare(ApiResourceKind.agent, { name: "A", slug: "a", org: "o" })).toBe("\nA  acme/a\n");
  });

  it("draws a bare skill, environment and organization as their titles and what is always said", () => {
    expect(bare(ApiResourceKind.skill, { slug: "s", org: "o" })).toBe("\ns  acme/s\n");
    expect(bare(ApiResourceKind.skill, { slug: "s" })).toBe("\ns  s\n");
    expect(bare(ApiResourceKind.environment, { slug: "e", org: "o" })).toBe("\ne  acme/e\n\n  Network:  unrestricted\n");
    expect(bare(ApiResourceKind.organization, { slug: "o" })).toBe("\no  o\n");
    expect(bare(ApiResourceKind.organization, { name: "Org" })).toBe("\nOrg\n");
  });

  it("shows an agent's last change, or its creation when it never changed", () => {
    const audit = (createdAt: string, updatedAt?: string) => ({
      specAudit: {
        createdAt: timestampFromDate(new Date(createdAt)),
        ...(updatedAt === undefined ? {} : { updatedAt: timestampFromDate(new Date(updatedAt)) }),
      },
    });
    const agent = (a: ReturnType<typeof audit>) => create(AgentSchema, { metadata: { slug: "a" }, status: { audit: a } });
    expect(draw(ApiResourceKind.agent, AgentSchema, agent(audit(fixtures.at(0))))).toContain("Updated:  2026-10-30 09:15 UTC");
    expect(draw(ApiResourceKind.agent, AgentSchema, agent(audit(fixtures.at(0), fixtures.at(61))))).toContain(
      "Updated:  2026-10-30 10:16 UTC",
    );
  });

  it("shows an agent's tools as only the disallowed ones when it allows every tool", () => {
    const agent = create(AgentSchema, { metadata: { slug: "a" }, spec: { disallowedTools: ["Bash"] } });
    expect(draw(ApiResourceKind.agent, AgentSchema, agent)).toContain("Tools\n  Disallowed:  Bash\n");
  });

  it("lists a session with no runs without a Runs section, five without a note, six with one", () => {
    const session = (runs: number) =>
      draw(ApiResourceKind.session, SessionSchema, fixtures.session, { runs: fixtures.sessionRuns.slice(0, runs).map(runJson) });
    expect(session(0)).not.toContain("Runs");
    expect(draw(ApiResourceKind.session, SessionSchema, fixtures.session)).not.toContain("Runs");
    expect(session(5)).toContain("Runs\n");
    expect(session(5)).not.toContain("earlier");
    expect(session(6)).toContain("  … 1 earlier run\n");
    expect(session(7)).toContain("  … 2 earlier runs\n");
  });

  it("shows a session's run that has not started, and the agent it pinned or the assistant", () => {
    const pending = runJson(create(RunSchema, { metadata: { id: "run_p" }, status: { phase: RunPhase.RUN_PENDING } }));
    const pinned = create(SessionSchema, { metadata: { id: "ses_1" }, status: { agentId: "agt_9" } });
    const out = draw(ApiResourceKind.session, SessionSchema, pinned, { runs: [pending] });
    expect(out).toContain("  Agent:  agt_9\n");
    expect(out).toContain("  run_p  pending  not started\n");
    expect(out.split("\n")[1]).toBe("ses_1");
    const assistant = create(SessionSchema, { metadata: { id: "ses_2", name: "chat" }, status: { environment: { slug: "e" } } });
    const plain = draw(ApiResourceKind.session, SessionSchema, assistant);
    expect(plain).toContain("  Agent:        Assistant\n");
    expect(plain).toContain("  Environment:  e\n");
    expect(plain.split("\n")[1]).toBe("chat");
    const sourceOnly = create(SessionSchema, { metadata: { id: "ses_3" }, status: { environmentSource: EnvironmentSource.AGENT } });
    expect(draw(ApiResourceKind.session, SessionSchema, sourceOnly)).not.toContain("Environment");
  });

  it("says why a run stopped only when it did not complete, a cancel by its cause alone", () => {
    const run = (phase: RunPhase, error = "", stopCause = "") =>
      create(RunSchema, { metadata: { id: "run_1" }, status: { phase, error, stopCause } });
    expect(draw(ApiResourceKind.run, RunSchema, run(RunPhase.RUN_COMPLETED, "ignored", "budget_reached"))).not.toContain("Why it stopped");
    expect(draw(ApiResourceKind.run, RunSchema, run(RunPhase.RUN_CANCELLED, "", "user"))).toContain(
      "Why it stopped\n  Stop cause:  user\n",
    );
    expect(draw(ApiResourceKind.run, RunSchema, run(RunPhase.RUN_FAILED, "", "budget_reached"))).toContain("Stop cause:  budget reached");
  });

  it("shows a routine that runs only when fired, active, with its next run and a last run with no id", () => {
    const routine = create(RoutineSchema, {
      metadata: { slug: "r" },
      spec: { timeZone: "UTC" },
      status: { nextFireAt: timestampFromDate(new Date(fixtures.at(60))), lastFireAt: timestampFromDate(new Date(fixtures.at(-60))) },
    });
    const out = draw(ApiResourceKind.routine, RoutineSchema, routine);
    expect(out).toContain("  Schedule:  only when fired\n");
    expect(out).toContain("  Enabled:   no\n");
    expect(out).toContain("  State:     active\n");
    expect(out).toContain("  Next run:  2026-10-30 10:15 UTC\n");
    expect(out).toContain("  Last run:  2026-10-30 08:15 UTC\n");
    expect(out).not.toContain("Paused because");
    expect(out).not.toContain("Message");
    const idOnly = create(RoutineSchema, { metadata: { slug: "r" }, status: { lastRunId: "run_9" } });
    expect(draw(ApiResourceKind.routine, RoutineSchema, idOnly)).not.toContain("Last run");
  });

  it("says a limited Environment's registries and MCP servers are reachable or not", () => {
    const limited = (allowMcpServers: boolean) =>
      create(EnvironmentSchema, { metadata: { slug: "e" }, spec: { networking: { type: NetworkingType.limited, allowMcpServers } } });
    const out = draw(ApiResourceKind.environment, EnvironmentSchema, limited(true));
    expect(out).toContain("Package registries:  not reachable");
    expect(out).toContain("MCP servers:         reachable");
    expect(out).not.toContain("Allowed hosts");
    expect(out).not.toContain("Packages");
  });
});

describe("CLI-09 the generic view, every other kind's, gains Created and Updated", () => {
  it("prints when a vault was created and last changed", () => {
    const vault = create(VaultSchema, {
      metadata: { id: "vlt_1", name: "Keys", slug: "keys" },
      status: {
        audit: {
          specAudit: {
            createdAt: timestampFromDate(new Date(fixtures.at(0))),
            updatedAt: timestampFromDate(new Date(fixtures.at(30))),
          },
        },
      },
    });
    const out = renderResource(VaultSchema, vault, "table", { hideOrg: true });
    expect(out).toContain("  Created:  2026-10-30 09:15 UTC\n");
    expect(out).toContain("  Updated:  2026-10-30 09:45 UTC\n");
  });

  it("prints none for a resource with no audit, and an instant it cannot read as given", () => {
    const vault = create(VaultSchema, { metadata: { id: "vlt_1" } });
    expect(renderResource(VaultSchema, vault, "table", { hideOrg: true })).not.toContain("Created");
    expect(instant("not a date")).toBe("not a date");
    expect(instant("")).toBeUndefined();
  });
});

describe("CLI-09 renderGet: json and yaml whole, a designed view for its kinds, the generic view for the rest", () => {
  const listed: string[] = [];
  const client = {
    run: {
      listBySession: async (request: { sessionId: string }) => {
        listed.push(request.sessionId);
        return { entries: fixtures.sessionRuns.slice(0, 2), nextPageToken: "" };
      },
    },
  } as unknown as Stigmer;

  it("prints the whole resource for json and yaml, reading nothing more", async () => {
    listed.length = 0;
    for (const format of ["json", "yaml"] as const) {
      expect(await renderGet(client, ApiResourceKind.session, SessionSchema, fixtures.session, format)).toBe(
        renderResource(SessionSchema, fixtures.session, format),
      );
    }
    expect(listed).toEqual([]);
  });

  it("draws a session's view with its runs, read by its id", async () => {
    listed.length = 0;
    const out = await renderGet(client, ApiResourceKind.session, SessionSchema, fixtures.session, "table", { orgLabel: "acme" });
    expect(listed).toEqual([fixtures.session.metadata!.id]);
    expect(out).toContain("Q3 ledger variance review  acme/ses-01jddd\n");
    expect(out).toContain("  run_01jeeeeeeeeeeeeeeeeeeeeee6  failed");
  });

  it("draws a designed kind without a loader, and keeps the generic view for a kind without a view", async () => {
    const agent = await renderGet(client, ApiResourceKind.agent, AgentSchema, fixtures.agent, "table", { hideOrg: true });
    expect(agent.split("\n")[1]).toBe("Variance Reporter  variance-reporter");
    const vault = create(VaultSchema, { metadata: { id: "vlt_1", name: "Keys" } });
    expect(await renderGet(client, ApiResourceKind.vault, VaultSchema, vault, "table")).toBe(renderResource(VaultSchema, vault, "table"));
  });

  it("reads the terminal's width on a terminal and none piped", () => {
    expect(terminalWidth({ isTTY: true, columns: 80 })).toBe(80);
    expect(terminalWidth({ isTTY: true, columns: 0 })).toBeUndefined();
    expect(terminalWidth({ isTTY: true })).toBeUndefined();
    expect(terminalWidth({ isTTY: false, columns: 80 })).toBeUndefined();
    expect(terminalWidth({})).toBeUndefined();
  });
});

describe("CLI-09 get loads the views lazily, inside its action", () => {
  it("imports no view module statically from the command", () => {
    const source = readFileSync(new URL("../../../commands/get.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/^\s*import\s+(?!type\s)[^;]*?from\s+["'][^"']*resources\/views/m);
    expect(source).toContain('import("../resources/views/index.js")');
  });
});
