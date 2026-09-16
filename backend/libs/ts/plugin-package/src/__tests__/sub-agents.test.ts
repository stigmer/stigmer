/**
 * Pins sub-agent normalisation: `agents/*.md` read under vendor manifests
 * and recorded as ignored under a root-only manifest; the body as
 * instructions; name from frontmatter or file stem; Claude `skills:`
 * matched to the plugin's skills; `model` classified into an alias (never
 * an id); every other frontmatter field warned once; declared agent paths
 * that are files or directories.
 */

import { describe, expect, it } from "vitest";

import { classifyModel } from "../normalise/sub-agents.js";
import { claudePlugin, cursorPlugin, openPlugin } from "../testing.js";
import { accepted, kindsOf, read } from "../__test-utils__/read.js";

describe("discovery", () => {
  it("reads agents/*.md under a Cursor manifest into SubAgent shapes", () => {
    const plugin = accepted(
      read(
        cursorPlugin({
          agents: [{ file: "reviewer", frontmatter: { name: "code-reviewer", description: "Reviews code." }, body: "Review the diff carefully and report findings.\n" }],
        }),
      ),
    );
    expect(plugin.subAgents).toEqual([
      {
        name: "code-reviewer",
        description: "Reviews code.",
        instructions: "Review the diff carefully and report findings.",
        skillNames: [],
        path: "agents/reviewer.md",
      },
    ]);
  });

  it("records agents/ as ignored, unread, under a root-only manifest", () => {
    const files = openPlugin();
    files.set("agents/x.md", "---\nname: x\n---\nthis frontmatter would be fine");
    const plugin = accepted(read(files));
    expect(plugin.subAgents).toEqual([]);
    expect(plugin.ignored).toEqual([{ kind: "agents", path: "agents/" }]);
  });

  it("reads declared agent files and directories, replacing the default directory", () => {
    const files = claudePlugin({ manifest: { agents: ["./custom/one.md", "./more/"] } });
    files.set("custom/one.md", "---\nname: one\n---\nDo the first thing well.");
    files.set("more/two.md", "---\nname: two\n---\nDo the second thing well.");
    files.set("agents/ignored.md", "---\nname: three\n---\nNot read: the manifest replaced agents/.");
    const plugin = accepted(read(files));
    expect(plugin.subAgents.map((a) => a.name)).toEqual(["one", "two"]);
  });

  it("names a bare prompt after its file with a warning", () => {
    const outcome = read(claudePlugin({ agents: [{ file: "helper", frontmatter: null, body: "You help with everything, patiently." }] }));
    expect(kindsOf(outcome)).toEqual({ errors: [], warnings: ["sub-agent-name-defaulted"] });
    expect(accepted(outcome).subAgents[0]).toMatchObject({ name: "helper", instructions: "You help with everything, patiently." });
  });
});

describe("frontmatter fields", () => {
  it("matches Claude skills: to the plugin's skills and warns on the rest", () => {
    const outcome = read(
      claudePlugin({
        skills: [{ name: "known", description: "d" }],
        agents: [{ file: "a", frontmatter: { skills: ["known", "unknown"] } }],
      }),
    );
    expect(kindsOf(outcome).warnings).toEqual(["sub-agent-skill-unknown"]);
    expect(accepted(outcome).subAgents[0]?.skillNames).toEqual(["known"]);
  });

  it("classifies model into an alias and warns on one it cannot map", () => {
    const outcome = read(
      cursorPlugin({
        agents: [
          { file: "fast", frontmatter: { model: "fast" } },
          { file: "sonnet", frontmatter: { model: "claude-sonnet-4-5" } },
          { file: "inherit", frontmatter: { model: "inherit" } },
          { file: "grok", frontmatter: { model: "grok-4.6[effort=xhigh]" } },
          { file: "none", frontmatter: {} },
        ],
      }),
    );
    expect(kindsOf(outcome).warnings).toEqual(["sub-agent-model-unknown"]);
    const hints = accepted(outcome).subAgents.map((a) => [a.name, a.modelHint?.alias]);
    expect(hints).toEqual([
      ["fast", "fast"],
      ["grok", "unknown"],
      ["inherit", "inherit"],
      ["none", undefined],
      ["sonnet", "sonnet"],
    ]);
  });

  it("warns once per field Stigmer does not read", () => {
    const outcome = read(cursorPlugin({ agents: [{ file: "a", frontmatter: { readonly: true, is_background: false, effort: "high" } }] }));
    expect(kindsOf(outcome).warnings).toEqual(["sub-agent-field-ignored", "sub-agent-field-ignored", "sub-agent-field-ignored"]);
  });
});

describe("classifyModel", () => {
  it("maps the dialects' spellings onto the alias set", () => {
    expect(classifyModel("fast").alias).toBe("fast");
    expect(classifyModel("Sonnet").alias).toBe("sonnet");
    expect(classifyModel("claude-opus-4-1").alias).toBe("opus");
    expect(classifyModel("claude-haiku-4.5").alias).toBe("haiku");
    expect(classifyModel("inherit").alias).toBe("inherit");
    expect(classifyModel("gpt-5").alias).toBe("unknown");
    expect(classifyModel("gpt-5").raw).toBe("gpt-5");
  });
});
