/**
 * No two neighbours in the docs sidebar share a name.
 *
 * The first case reads the real `docs/` tree, so a folder titled like the
 * page listed beside it fails here, naming both entries. The rest hold what
 * counts as a neighbour and as a label, on small trees written for the case.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { repeatedSidebarLabels } from "../sidebar-labels";

const DOCS = join(dirname(fileURLToPath(import.meta.url)), "../../../../docs");

const page = (title: string): string => `---\ntitle: ${title}\n---\n\nText.\n`;
const meta = (data: object): string => JSON.stringify(data);

const made: string[] = [];

/** A docs tree on disk, from a map of path to contents. */
function tree(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "sidebar-labels-"));
  made.push(dir);
  for (const [file, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), contents);
  }
  return dir;
}

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("the docs sidebar's labels", () => {
  it("gives no two neighbours the same name, anywhere in docs/", () => {
    expect(repeatedSidebarLabels(DOCS), "rename one of each pair (docs/CONTRIBUTING.md, \"Sidebar ordering\")").toEqual([]);
  });

  it("names a page and the folder beside it that share a title, with the group they sit in", () => {
    const docs = tree({
      "meta.json": meta({ pages: ["---Get Started---", "index", "---Reach an agent---", "concepts/channels", "guides/channels"] }),
      "index.mdx": page("Welcome"),
      "concepts/channels.mdx": page("Channels"),
      "guides/channels/meta.json": meta({ title: "Channels", pages: ["connect-slack"] }),
      "guides/channels/connect-slack.mdx": page("Connect Slack"),
    });
    expect(repeatedSidebarLabels(docs)).toEqual([
      { label: "Channels", where: 'docs/meta.json, group "Reach an agent"', entries: ["concepts/channels", "guides/channels"] },
    ]);
  });

  it("lets two groups at the top each hold the same name", () => {
    const docs = tree({
      "meta.json": meta({ pages: ["concepts/overview", "---How it works---", "guides/overview"] }),
      "concepts/overview.mdx": page("Overview"),
      "guides/overview.mdx": page("Overview"),
    });
    expect(repeatedSidebarLabels(docs)).toEqual([]);
  });

  it("reads a link entry's own text as its label", () => {
    const docs = tree({
      "meta.json": meta({ pages: ["[Editions](/docs/guides/editions)", "concepts/editions"] }),
      "concepts/editions.mdx": page("Editions"),
    });
    expect(repeatedSidebarLabels(docs)).toEqual([
      { label: "Editions", where: "docs/meta.json", entries: ["[Editions](/docs/guides/editions)", "concepts/editions"] },
    ]);
  });

  it("checks every folder below the top, across the headings inside it", () => {
    const docs = tree({
      "meta.json": meta({ pages: ["sdk"] }),
      "sdk/meta.json": meta({ title: "SDK", root: true, pages: ["index", "---API Clients---", "typescript", "---UI Toolkits---", "react"] }),
      "sdk/index.mdx": page("SDK"),
      "sdk/typescript.mdx": page("Reference"),
      "sdk/react/meta.json": meta({ title: "Reference", pages: ["hooks"] }),
      "sdk/react/hooks.mdx": page("Hooks"),
    });
    expect(repeatedSidebarLabels(docs)).toEqual([{ label: "Reference", where: "docs/sdk/meta.json", entries: ["typescript", "react"] }]);
  });

  it("refuses a folder whose meta.json lists no pages, naming the file", () => {
    const docs = tree({
      "meta.json": meta({ pages: ["guides"] }),
      "guides/meta.json": meta({ title: "Guides" }),
    });
    expect(() => repeatedSidebarLabels(docs)).toThrow('docs/guides/meta.json: no "pages" list');
  });

  it("refuses an entry form it was not taught, naming the file and the entry", () => {
    const docs = tree({
      "meta.json": meta({ pages: ["index", "..."] }),
      "index.mdx": page("Welcome"),
    });
    expect(() => repeatedSidebarLabels(docs)).toThrow('docs/meta.json: the entry "..." is not one page or one folder with a meta.json');
  });

  it("names a folder with no title of its own after its index page, as the sidebar does", () => {
    const docs = tree({
      "meta.json": meta({ pages: ["channels", "[Channels](/docs/channels)"] }),
      "channels/meta.json": meta({ pages: ["connect-slack"] }),
      "channels/index.mdx": page("Channels"),
      "channels/connect-slack.mdx": page("Connect Slack"),
    });
    expect(repeatedSidebarLabels(docs)).toEqual([
      { label: "Channels", where: "docs/meta.json", entries: ["channels", "[Channels](/docs/channels)"] },
    ]);
  });

  it("reads a folder's meta.json title before its index page's", () => {
    const docs = tree({
      "meta.json": meta({ pages: ["sdk", "concepts/sdk"] }),
      "sdk/meta.json": meta({ title: "SDK reference", pages: [] }),
      "sdk/index.mdx": page("SDK"),
      "concepts/sdk.mdx": page("SDK"),
    });
    expect(repeatedSidebarLabels(docs)).toEqual([]);
  });

  it("refuses a page or a folder with no title, naming the file", () => {
    const untitledPage = tree({ "meta.json": meta({ pages: ["index"] }), "index.mdx": "Text.\n" });
    expect(() => repeatedSidebarLabels(untitledPage)).toThrow("docs/index.mdx: no title");
    const untitledFolder = tree({ "meta.json": meta({ pages: ["guides"] }), "guides/meta.json": meta({ pages: [] }) });
    expect(() => repeatedSidebarLabels(untitledFolder)).toThrow("docs/guides: no title in its meta.json and no index.mdx");
    const untitledIndex = tree({ "meta.json": meta({ pages: ["channels"] }), "channels/meta.json": meta({ pages: [] }), "channels/index.mdx": "Text.\n" });
    expect(() => repeatedSidebarLabels(untitledIndex)).toThrow("docs/channels/index.mdx: no title");
  });
});
