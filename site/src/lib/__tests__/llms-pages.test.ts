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
    expect(linkTargetRelativePath("[Overview](/docs/guides/runners)")).toBe(
      "guides/runners",
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

describe("cleanContent", () => {
  it("strips import lines and MDX comments, keeping the prose", () => {
    const body = 'import { Hero } from "@/components/docs";\n\n{/* A note. */}\nProse stays.';
    expect(cleanContent(body, SITE_URL)).toBe("Prose stays.");
  });
});

describe("a <Screen> in the export", () => {
  const IMAGE = `${SITE_URL}/screens/approval-2x.webp`;

  it("becomes a markdown image of its alt text, linked to the sharpest file on the site", () => {
    const body = 'Before.\n\n<Screen name="approval" alt="A tool call waits for approval" />\n\nAfter.';
    expect(cleanContent(body, SITE_URL)).toBe(`Before.\n\n![A tool call waits for approval](${IMAGE})\n\nAfter.`);
  });

  it("reads its attributes in either order, either quote, across lines, beside the component's own", () => {
    const body = "<Screen\n  zoom={false}\n  alt='The approval card'\n  sizes=\"100vw\"\n  name=\"approval\"\n/>";
    expect(cleanContent(body, SITE_URL)).toBe(`![The approval card](${IMAGE})`);
  });

  it("keeps the alt text on one line and escapes what would end its label", () => {
    const body = '<Screen name="approval" alt="Approve [or deny]\n  a path like C:\\work" />';
    expect(cleanContent(body, SITE_URL)).toBe(`![Approve [or deny\\] a path like C:\\\\work](${IMAGE})`);
  });

  it("leaves a tag inside a fenced code block as written, and rewrites the one after it", () => {
    const shown = '```mdx\n<Screen name="unknown" alt="" />\n```';
    const tilde = '~~~~\n<Screen name="unknown">\n```\n~~~~';
    const body = `${shown}\n\n${tilde}\n\n<Screen name="approval" alt="Approval" />`;
    expect(cleanContent(body, SITE_URL)).toBe(`${shown}\n\n${tilde}\n\n![Approval](${IMAGE})`);
  });

  it("leaves a component whose name only starts with Screen alone", () => {
    expect(cleanContent("<ScreenReaderNote>text</ScreenReaderNote>", SITE_URL)).toBe("<ScreenReaderNote>text</ScreenReaderNote>");
  });

  it.each([
    ["is not self-closing", '<Screen name="approval" alt="Approval"></Screen>', /must close itself/],
    ["cannot be read", '<Screen name="approval" alt="Approval" {...props} />', /cannot read/],
    ["has no alt", '<Screen name="approval" />', /needs name="…" and alt="…" as plain strings/],
    ["gives its alt as an expression", '<Screen name="approval" alt={label} />', /as plain strings/],
    ["gives its name as an expression", '<Screen name={name} alt="Approval" />', /as plain strings/],
    ["has blank alt text", '<Screen name="approval" alt=" " />', /alt text is required/],
    ["names a screen the suite does not show", '<Screen name="dashboard" alt="Figures" />', /no screen named "dashboard"/],
  ])("fails the export when the tag %s", (_, body, message) => {
    expect(() => cleanContent(body, SITE_URL)).toThrow(message);
  });

  it("names the page whose tag fails, so the build says where to look", async () => {
    const dir = await setup({
      "index.mdx": mdx("Home"),
      "meta.json": meta({ pages: ["guide"] }),
      "guide.mdx": `${mdx("Guide")}\n<Screen name="approval" />\n`,
    });
    await expect(collectDocsPages(dir, SITE_URL)).rejects.toThrow(/^docs\/guide\.mdx: a <Screen> tag needs/);
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
        pages: ["---Runners---", "[Overview](/docs/guides/runners)"],
      }),
      "guides/runners/index.mdx": mdx("Runners Overview"),
    });

    const pages = await collectDocsPages(dir, SITE_URL);
    const overview = pages.find((p) => p.relativePath === "guides/runners");
    expect(overview).toBeDefined();
    expect(overview?.topSectionTitle).toBe("Runners");
    // The nav label is presentation-only; content keeps the frontmatter title.
    expect(overview?.title).toBe("Runners Overview");
  });

  it("lists a page once when a link entry names it before its folder is listed", async () => {
    const dir = await setup({
      "index.mdx": mdx("Home"),
      "meta.json": meta({
        pages: [
          "---Get Started---",
          "[Run it on your servers](/docs/guides/self-hosting/overview)",
          "---Platform---",
          "guides/self-hosting",
        ],
      }),
      "guides/self-hosting/meta.json": meta({ title: "Self-hosting", pages: ["overview", "kubernetes"] }),
      "guides/self-hosting/overview.mdx": mdx("Self-hosting"),
      "guides/self-hosting/kubernetes.mdx": mdx("Kubernetes"),
    });

    const pages = await collectDocsPages(dir, SITE_URL);
    const overview = pages.filter((p) => p.relativePath === "guides/self-hosting/overview");
    expect(overview).toHaveLength(1);
    expect(overview[0].topSectionTitle).toBe("Get Started");
    expect(pages.some((p) => p.relativePath === "guides/self-hosting/kubernetes")).toBe(true);
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
      "meta.json": meta({ pages: ["---Agents---", "guides/channels"] }),
      "guides/channels/meta.json": meta({ title: "Channels", pages: ["create-a-chat-link"] }),
      "guides/channels/create-a-chat-link.mdx": mdx("Create a chat link"),
    });

    const pages = await collectDocsPages(dir, SITE_URL);
    expect(
      pages.find((p) => p.relativePath === "guides/channels/create-a-chat-link")
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
