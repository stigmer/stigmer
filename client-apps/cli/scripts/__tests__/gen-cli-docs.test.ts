import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildProgram } from "../../src/program.js";
import { examples } from "../../src/command-tree.js";
import { checkEnrichment, checkPageExamples, generate, renderDefaultPage, renderEnrichedPage } from "../gen-cli-docs.js";

const enrichmentsDir = join(dirname(fileURLToPath(import.meta.url)), "../../docs/commands");

let outputDir: string;

beforeEach(() => {
  outputDir = mkdtempSync(join(tmpdir(), "gen-cli-docs-"));
});

afterEach(() => {
  rmSync(outputDir, { recursive: true, force: true });
});

describe("generate", () => {
  it("renders an enriched page for every documented command (no defaults)", () => {
    const result = generate(outputDir, enrichmentsDir);

    // Every documented command must have a hand-written enrichment template;
    // a non-zero `defaulted` count means a command lost its prose to the
    // fallback renderer and needs a template in docs/commands/.
    expect(result.defaulted).toBe(0);
    expect(result.enriched).toBeGreaterThan(0);

    const files = readdirSync(outputDir);
    expect(files).toContain("index.mdx");
    expect(files).toContain("meta.json");
    // One .mdx per command, plus index.mdx.
    const mdx = files.filter((f) => f.endsWith(".mdx"));
    expect(mdx.length).toBe(result.enriched + 1);
  });

  it("emits a meta.json whose pages are grouped and the index leads", () => {
    generate(outputDir, enrichmentsDir);
    const meta = JSON.parse(readFileSync(join(outputDir, "meta.json"), "utf8")) as {
      title: string;
      pages: string[];
    };

    expect(meta.title).toBe("Commands");
    expect(meta.pages[0]).toBe("index");
    expect(meta.pages).toContain("---Run agents---");
    expect(meta.pages).toContain("---Configuration---");
    // Group separators precede their members; "run" appears after the Run
    // agents header and before the Your library header.
    const runAgents = meta.pages.indexOf("---Run agents---");
    const library = meta.pages.indexOf("---Your library---");
    const run = meta.pages.indexOf("run");
    expect(runAgents).toBeLessThan(run);
    expect(run).toBeLessThan(library);
  });

  it("orders the index groups and sorts commands within each group", () => {
    generate(outputDir, enrichmentsDir);
    const index = readFileSync(join(outputDir, "index.mdx"), "utf8");

    // The groups in help's order: run agents first, configuration last.
    const headings = [...index.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
    expect(headings).toEqual(["Run agents", "Your library", "Packages", "Local stack", "Account and access", "Configuration", "Global Flags"]);
    // Within Your library, apply sorts before validate.
    expect(index.indexOf("[`stigmer apply`]")).toBeLessThan(index.indexOf("[`stigmer validate`]"));
    expect(index).toContain("## Global Flags");
  });

  it("throws when a visible command has no help group", () => {
    const program = buildProgram();
    program.command("bogus").description("an ungrouped command");
    expect(() => generate(outputDir, enrichmentsDir, program)).toThrow(/"bogus" has no help group/);
  });

  it("CLI-10 throws when a page leaves out one of its commands' help examples, naming the line", () => {
    const program = buildProgram();
    const get = program.commands.find((cmd) => cmd.name() === "get")!;
    examples(get, [{ say: "a line no page shows", run: "stigmer get agent nowhere-on-the-page" }]);
    expect(() => generate(outputDir, enrichmentsDir, program)).toThrow(/get\.mdx is missing help examples of `stigmer get`[\s\S]*stigmer get agent nowhere-on-the-page/);
  });

  it("reads a line continued with a backslash as the line up to it, and never a part of a line", () => {
    const page = "```bash\nstigmer get agent my-agent \\\n  -o yaml\nstigmer get agent my-agent-two\n```\n";
    const continued = examples(new Command("get"), [{ say: "continued", run: "stigmer get agent my-agent" }]);
    expect(() => checkPageExamples(continued, page, "get.mdx")).not.toThrow();
    const partial = examples(new Command("get"), [{ say: "a prefix of a line", run: "stigmer get agent my-agent-t" }]);
    expect(() => checkPageExamples(partial, page, "get.mdx")).toThrow(/missing help examples/);
  });
});

describe("checkEnrichment", () => {
  // The template is pasted into the page verbatim and then prose-wrapped by
  // Prettier, whose MDX mode reads a wrapped span's continuation line as
  // block syntax and splits the paragraph; the site build then fails on an
  // unclosed span or a bare <placeholder>. The guard refuses the template
  // before any page is written.
  it("refuses an inline code span that does not close on its line, naming the line", () => {
    const template = [
      "### What the install leaves to do",
      "",
      "A server names the command that runs it (`stigmer connect mcp-server",
      "<server>`, which opens the console's sign-in); a server already signed in",
      "says so.",
    ].join("\n");

    expect(() => checkEnrichment("docs/commands/install.mdx", template)).toThrow(
      "enrichment docs/commands/install.mdx line 3: an inline code span opens here and does not close on this line. " +
        "Prettier and MDX read a span wrapped across lines as a broken paragraph. Keep each backtick span on one line.",
    );
  });

  it("accepts every shape the templates use: one-line spans, fences, double-backtick spans", () => {
    const template = [
      "Run `stigmer connect mcp-server <server>` once; a second span on the",
      "same line, `stigmer install stigmer/linear`, closes too.",
      "",
      "```bash",
      "echo `not a span, a fenced line`",
      "` a lone backtick inside a fence",
      "```",
      "",
      "- A fence under a bullet:",
      "",
      "  ```yaml",
      "  key: `value",
      "  ```",
      "",
      "~~~",
      "` a lone backtick inside a tilde fence",
      "~~~",
      "",
      "A span carrying a backtick: `` a`b `` reads whole.",
    ].join("\n");

    expect(() => checkEnrichment("docs/commands/demo.mdx", template)).not.toThrow();
  });
});

describe("renderEnrichedPage", () => {
  it("replaces AUTO markers and escapes bare placeholders in injected prose", () => {
    const cmd = new Command("demo").description("a demo command");
    cmd
      .command("sub <id>")
      .description("operate on <id> records")
      .option("-f, --flag <value>", "a sample flag");

    const enrichment = ["Hand-written intro.", "", "{/* AUTO_USAGE */}", "", "{/* AUTO_SUBCOMMANDS */}", ""].join("\n");
    const page = renderEnrichedPage(cmd, [], enrichment);

    expect(page).toMatchInlineSnapshot(`
      "---
      title: demo
      description: a demo command
      ---

      {/* Auto-generated by gen-cli-docs. Do not edit manually. */}
      {/* To enrich this page, edit the template in client-apps/cli/docs/commands/ */}

      Hand-written intro.

      ## Usage

      \`\`\`bash
      demo
      \`\`\`

      ## Subcommands

      ### demo sub

      operate on \`<id>\` records

      \`\`\`bash
      demo sub <id> [flags]
      \`\`\`

      | Flag | Type | Default | Description |
      |------|------|---------|-------------|
      | \`--flag\`, \`-f\` | \`string\` |  | a sample flag |
      "
    `);
  });
});

describe("renderDefaultPage", () => {
  it("renders usage, options, and a back-link for an un-enriched command", () => {
    const cmd = new Command("solo").description("a solo command").option("--name <name>", "the name");
    const page = renderDefaultPage(cmd, []);

    expect(page).toContain("title: solo");
    expect(page).toContain("## Usage");
    expect(page).toContain("solo [flags]");
    expect(page).toContain("## Options");
    expect(page).toContain("`--name`");
    expect(page).toContain("## See also");
    expect(page).toContain("[Command Reference](./)");
  });
});
