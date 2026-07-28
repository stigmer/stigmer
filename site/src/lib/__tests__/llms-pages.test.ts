import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  cleanContent,
  collectDocsPages,
  findUncollectedPages,
  isLinkEntry,
  isSeparator,
  linkTargetRelativePath,
  markdownExportUrl,
  separatorLabel,
  unwrapStills,
} from "../llms-pages";

const SITE_URL = "https://example.test";

/** Materializes a docs tree from a { relativePath: contents } map. */
async function makeDocsDir(files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "llms-pages-"));
  for (const [rel, contents] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, contents, "utf-8");
  }
  return dir;
}

function mdx(title: string): string {
  return `---\ntitle: ${title}\ndescription: About ${title}.\n---\n\n# ${title}\n`;
}

function meta(data: object): string {
  return JSON.stringify(data);
}

const tempDirs: string[] = [];

async function setup(files: Record<string, string>): Promise<string> {
  const dir = await makeDocsDir(files);
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("entry classification", () => {
  it("recognizes separators and extracts their labels", () => {
    expect(isSeparator("---Tools & MCP---")).toBe(true);
    expect(isSeparator("concepts/agents")).toBe(false);
    expect(separatorLabel("---Tools & MCP---")).toBe("Tools & MCP");
  });

  it("recognizes link entries", () => {
    expect(isLinkEntry("[Welcome](/docs)")).toBe(true);
    expect(isLinkEntry("[Icon][GitHub](https://github.com)")).toBe(true);
    expect(isLinkEntry("concepts/agents")).toBe(false);
    expect(isLinkEntry("index")).toBe(false);
  });

  it("extracts internal link targets and rejects external ones", () => {
    expect(linkTargetRelativePath("[Welcome](/docs)")).toBe("");
    expect(linkTargetRelativePath("[Overview](/docs/guides/workflows)")).toBe(
      "guides/workflows",
    );
    expect(linkTargetRelativePath("[GitHub](https://github.com)")).toBeNull();
    expect(linkTargetRelativePath("[Pricing](/pricing)")).toBeNull();
  });

  it("maps page URLs to their markdown export URLs", () => {
    expect(markdownExportUrl("/docs/concepts/agents")).toBe(
      "/docs/concepts/agents.md",
    );
    // Folder index pages export beside their folder, not inside it.
    expect(markdownExportUrl("/docs/sdk")).toBe("/docs/sdk.md");
    // The docs root is the one exception: the writer lands it at
    // docs/index.md, so /docs.md must never be linked.
    expect(markdownExportUrl("/docs")).toBe("/docs/index.md");
  });
});

describe("unwrapStills", () => {
  const URL_BASE = "https://stigmer.ai/demos";

  it("rewrites a <Still> into a markdown image linking the light variant", () => {
    expect(
      unwrapStills('<Still id="agent-detail-tour/agent-detail" alt="The Agent detail page." />'),
    ).toBe(
      `![The Agent detail page.](${URL_BASE}/agent-detail-tour/stills/agent-detail.light.png)`,
    );
  });

  it("rewrites every still on a page, independent of attribute order", () => {
    const page = [
      "Intro prose.",
      '<Still alt="First screen." id="tour/one" />',
      "Middle prose.",
      '<Still id="tour/two" alt="Second screen." />',
    ].join("\n\n");
    const out = unwrapStills(page);
    expect(out).toContain(`![First screen.](${URL_BASE}/tour/stills/one.light.png)`);
    expect(out).toContain(`![Second screen.](${URL_BASE}/tour/stills/two.light.png)`);
    expect(out).not.toContain("<Still");
  });

  it("handles a Prettier-split multi-line tag", () => {
    const tag = [
      "<Still",
      '  id="agent-detail-tour/agent-detail"',
      '  alt="The Agent detail page with both Skills and the MCP server visible."',
      "/>",
    ].join("\n");
    expect(unwrapStills(tag)).toBe(
      "![The Agent detail page with both Skills and the MCP server visible.]" +
        `(${URL_BASE}/agent-detail-tour/stills/agent-detail.light.png)`,
    );
  });

  it("escapes square brackets in alt text so the markdown image stays intact", () => {
    const out = unwrapStills('<Still id="t/s" alt="The [Save] button" />');
    expect(out).toBe(`![The \\[Save\\] button](${URL_BASE}/t/stills/s.light.png)`);
  });

  it("collapses source-line wrapping inside a long alt value", () => {
    // Prettier wraps long attribute values across lines in prose-wrapped
    // MDX; the newlines are formatting, not content.
    const tag = '<Still\n  id="t/s"\n  alt="A long description\nthat Prettier wrapped\nacross lines."\n/>';
    expect(unwrapStills(tag)).toBe(
      `![A long description that Prettier wrapped across lines.](${URL_BASE}/t/stills/s.light.png)`,
    );
  });

  it("leaves a <Still> inside a fenced code block untouched", () => {
    const page = [
      "Use it like this:",
      "```mdx",
      '<Still id="tour/shot" alt="Example usage." />',
      "```",
      '<Still id="tour/shot" alt="A real one." />',
    ].join("\n");
    const out = unwrapStills(page);
    // The fenced example survives byte-for-byte; the real tag is rewritten.
    expect(out).toContain('```mdx\n<Still id="tour/shot" alt="Example usage." />\n```');
    expect(out).toContain(`![A real one.](${URL_BASE}/tour/stills/shot.light.png)`);
  });

  it("leaves malformed tags alone for invariant 8 to reject", () => {
    const missingAlt = '<Still id="tour/shot" />';
    const emptyAlt = '<Still id="tour/shot" alt="" />';
    const badId = '<Still id="no-slash" alt="Broken." />';
    for (const tag of [missingAlt, emptyAlt, badId]) {
      expect(unwrapStills(tag)).toBe(tag);
    }
  });

  it("never touches other components", () => {
    const embed = '<ScenarEmbed id="quickstart-tour" title="Quickstart walkthrough" />';
    expect(unwrapStills(embed)).toBe(embed);
  });
});

describe("cleanContent still handling", () => {
  it("does not unwrap a commented-out <Still> (comments strip first)", () => {
    const body = '{/* <Still id="tour/retired" alt="Old." /> */}\nProse stays.';
    expect(cleanContent(body)).toBe("Prose stays.");
  });

  it("unwraps live stills as part of cleaning", () => {
    const body = 'Lead-in.\n\n<Still id="tour/shot" alt="A screen." />';
    expect(cleanContent(body)).toBe(
      "Lead-in.\n\n![A screen.](https://stigmer.ai/demos/tour/stills/shot.light.png)",
    );
  });
});

describe("collectDocsPages", () => {
  it("assigns separator group labels as sections to cross-folder page refs", async () => {
    const dir = await setup({
      "index.mdx": mdx("Home"),
      "meta.json": meta({
        pages: ["---Agents---", "concepts/agents", "concepts/skills"],
      }),
      "concepts/agents.mdx": mdx("Agents"),
      "concepts/skills.mdx": mdx("Skills"),
    });

    const pages = await collectDocsPages(dir, SITE_URL);
    const agents = pages.find((p) => p.relativePath === "concepts/agents");
    expect(agents).toBeDefined();
    expect(agents?.topSectionTitle).toBe("Agents");
    expect(agents?.topSection).toBe("agents");
    expect(agents?.url).toBe(`${SITE_URL}/docs/concepts/agents`);
    expect(pages.find((p) => p.relativePath === "concepts/skills")?.topSectionTitle).toBe(
      "Agents",
    );
  });

  it("collects the root index page with an empty section", async () => {
    const dir = await setup({
      "index.mdx": mdx("Home"),
      "meta.json": meta({ pages: [] }),
    });

    const pages = await collectDocsPages(dir, SITE_URL);
    expect(pages).toHaveLength(1);
    expect(pages[0].relativePath).toBe("");
    expect(pages[0].topSection).toBe("");
    expect(pages[0].url).toBe(`${SITE_URL}/docs`);
  });

  it("does not duplicate the root page referenced by a [Welcome](/docs) link", async () => {
    const dir = await setup({
      "index.mdx": mdx("Home"),
      "meta.json": meta({ pages: ["---Get Started---", "[Welcome](/docs)"] }),
    });

    const pages = await collectDocsPages(dir, SITE_URL);
    // Exactly one entry for the root page: collected directly, not via the link.
    expect(pages.filter((p) => p.relativePath === "")).toHaveLength(1);
  });

  it("collects an internal link target that no other entry covers", async () => {
    const dir = await setup({
      "index.mdx": mdx("Home"),
      "meta.json": meta({
        pages: ["---Workflows---", "[Overview](/docs/guides/workflows)"],
      }),
      "guides/workflows/index.mdx": mdx("Workflows Overview"),
    });

    const pages = await collectDocsPages(dir, SITE_URL);
    const overview = pages.find((p) => p.relativePath === "guides/workflows");
    expect(overview).toBeDefined();
    expect(overview?.topSectionTitle).toBe("Workflows");
    // The nav label is presentation-only; content keeps the frontmatter title.
    expect(overview?.title).toBe("Workflows Overview");
  });

  it("skips external link entries", async () => {
    const dir = await setup({
      "index.mdx": mdx("Home"),
      "meta.json": meta({
        pages: ["---Get Started---", "[GitHub](https://github.com/stigmer)"],
      }),
    });

    const pages = await collectDocsPages(dir, SITE_URL);
    expect(pages).toHaveLength(1); // root page only
  });

  it("collects both the page and the folder children of a file+folder hybrid", async () => {
    const dir = await setup({
      "index.mdx": mdx("Home"),
      "meta.json": meta({ pages: ["guides"] }),
      "guides/meta.json": meta({ title: "Guides", pages: ["task-types"] }),
      "guides/task-types.mdx": mdx("Task Reference"),
      "guides/task-types/meta.json": meta({
        title: "Task Reference",
        pages: ["set-vars", "http-call"],
      }),
      "guides/task-types/set-vars.mdx": mdx("Set Vars"),
      "guides/task-types/http-call.mdx": mdx("HTTP Call"),
    });

    const pages = await collectDocsPages(dir, SITE_URL);
    const paths = pages.map((p) => p.relativePath);
    expect(paths).toContain("guides/task-types");
    expect(paths).toContain("guides/task-types/set-vars");
    expect(paths).toContain("guides/task-types/http-call");
  });

  it("includes a folder's index page even when its allowlist omits it", async () => {
    const dir = await setup({
      "index.mdx": mdx("Home"),
      "meta.json": meta({ pages: ["sdk"] }),
      "sdk/meta.json": meta({ title: "SDK", root: true, pages: ["react"] }),
      "sdk/react/meta.json": meta({ title: "React", pages: ["use-agent"] }),
      "sdk/react/index.mdx": mdx("React SDK"),
      "sdk/react/use-agent.mdx": mdx("useAgent"),
    });

    const pages = await collectDocsPages(dir, SITE_URL);
    const paths = pages.map((p) => p.relativePath);
    expect(paths).toContain("sdk/react");
    expect(paths).toContain("sdk/react/use-agent");
  });

  it("gives root:true folders their own section even after a separator", async () => {
    const dir = await setup({
      "index.mdx": mdx("Home"),
      "meta.json": meta({
        pages: ["---Platform---", "concepts/billing", "sdk"],
      }),
      "concepts/billing.mdx": mdx("Billing"),
      "sdk/meta.json": meta({ title: "SDK", root: true, pages: ["index"] }),
      "sdk/index.mdx": mdx("SDK Overview"),
    });

    const pages = await collectDocsPages(dir, SITE_URL);
    expect(pages.find((p) => p.relativePath === "concepts/billing")?.topSectionTitle).toBe(
      "Platform",
    );
    expect(pages.find((p) => p.relativePath === "sdk")?.topSectionTitle).toBe("SDK");
    expect(pages.find((p) => p.relativePath === "sdk")?.topSection).toBe("sdk");
  });

  it("keeps pre-separator folder entries as their own sections (interim rollout state)", async () => {
    const dir = await setup({
      "index.mdx": mdx("Home"),
      "meta.json": meta({
        pages: ["concepts", "---Agents---", "concepts/agents"],
      }),
      "concepts/meta.json": meta({ title: "Concepts", pages: ["tools"] }),
      "concepts/tools.mdx": mdx("Tools"),
      "concepts/agents.mdx": mdx("Agents"),
    });

    const pages = await collectDocsPages(dir, SITE_URL);
    expect(pages.find((p) => p.relativePath === "concepts/tools")?.topSectionTitle).toBe(
      "Concepts",
    );
    expect(pages.find((p) => p.relativePath === "concepts/agents")?.topSectionTitle).toBe(
      "Agents",
    );
  });

  it("collects folder refs listed under a separator into that group", async () => {
    const dir = await setup({
      "index.mdx": mdx("Home"),
      "meta.json": meta({ pages: ["---Agents---", "guides/sharing"] }),
      "guides/sharing/meta.json": meta({ title: "Sharing", pages: ["share-an-agent"] }),
      "guides/sharing/share-an-agent.mdx": mdx("Share an Agent"),
    });

    const pages = await collectDocsPages(dir, SITE_URL);
    expect(
      pages.find((p) => p.relativePath === "guides/sharing/share-an-agent")
        ?.topSectionTitle,
    ).toBe("Agents");
  });

  it("respects nested separators inside folder meta.json without changing the section", async () => {
    const dir = await setup({
      "index.mdx": mdx("Home"),
      "meta.json": meta({ pages: ["cli"] }),
      "cli/meta.json": meta({ title: "CLI", root: true, pages: ["commands"] }),
      "cli/commands/meta.json": meta({
        title: "Commands",
        pages: ["---Core Commands---", "run"],
      }),
      "cli/commands/run.mdx": mdx("run"),
    });

    const pages = await collectDocsPages(dir, SITE_URL);
    expect(pages.find((p) => p.relativePath === "cli/commands/run")?.topSectionTitle).toBe(
      "CLI",
    );
  });
});

describe("findUncollectedPages", () => {
  it("reports pages the collector missed and honors exclusions", async () => {
    const dir = await setup({
      "index.mdx": mdx("Home"),
      "meta.json": meta({ pages: ["concepts"] }),
      "concepts/meta.json": meta({ title: "Concepts", pages: ["tools"] }),
      "concepts/tools.mdx": mdx("Tools"),
      // In the folder but not in the allowlist — the collector will miss it.
      "concepts/orphan.mdx": mdx("Orphan"),
      "concepts/excused.mdx": mdx("Excused"),
    });

    const pages = await collectDocsPages(dir, SITE_URL);
    const missing = await findUncollectedPages(dir, pages, ["concepts/excused"]);
    expect(missing).toEqual(["concepts/orphan"]);
  });

  it("returns empty when everything is collected", async () => {
    const dir = await setup({
      "index.mdx": mdx("Home"),
      "meta.json": meta({ pages: ["concepts"] }),
      "concepts/meta.json": meta({ title: "Concepts", pages: ["tools"] }),
      "concepts/tools.mdx": mdx("Tools"),
    });

    const pages = await collectDocsPages(dir, SITE_URL);
    expect(await findUncollectedPages(dir, pages, [])).toEqual([]);
  });

  it("ignores the _archive directory (mirrors source.config.ts)", async () => {
    const dir = await setup({
      "index.mdx": mdx("Home"),
      "meta.json": meta({ pages: [] }),
      "_archive/old-page.mdx": mdx("Old Page"),
    });

    const pages = await collectDocsPages(dir, SITE_URL);
    expect(await findUncollectedPages(dir, pages, [])).toEqual([]);
  });
});
