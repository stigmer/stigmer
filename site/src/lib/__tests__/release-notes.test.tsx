/**
 * A section of release notes as the Releases page draws it
 * (lib/release-notes.tsx): the Markdown the notes use comes out as elements
 * with no Markdown mark left in the words, text in angle brackets survives,
 * and only an http(s) address becomes a link.
 *
 * Each case renders one piece of Markdown shaped like the real notes and
 * reads the elements and the visible text.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { renderReleaseNotes } from "@/lib/release-notes";

afterEach(cleanup);

async function drawn(markdown: string): Promise<HTMLElement> {
  return render(<div>{await renderReleaseNotes(markdown)}</div>).container;
}

/** The visible words, with runs of whitespace as one space. */
const words = (element: Element | null) => element?.textContent?.replace(/\s+/g, " ").trim();

describe("release notes", () => {
  it("draws each paragraph, joining a paragraph's wrapped lines", async () => {
    const container = await drawn("Every agent has its own computer,\na sandbox.\n\nRun it yourself.");

    expect([...container.querySelectorAll("p")].map(words)).toEqual([
      "Every agent has its own computer, a sandbox.",
      "Run it yourself.",
    ]);
  });

  it("draws a bold lead, inline code, and code inside bold", async () => {
    const container = await drawn(
      "**The `substrate` driver can't start a sandbox:** its template names `--snapshot-location`.",
    );

    expect(words(container.querySelector("strong"))).toBe("The substrate driver can't start a sandbox:");
    expect([...container.querySelectorAll("code")].map(words)).toEqual(["substrate", "--snapshot-location"]);
    expect(container.querySelector("strong code")).not.toBeNull();
    expect(words(container)).toBe("The substrate driver can't start a sandbox: its template names --snapshot-location.");
  });

  it("draws a Markdown link with its words", async () => {
    const container = await drawn("The [runners guide](https://stigmer.ai/docs/guides/self-hosting/runners) lists it.");
    const link = container.querySelector("a");

    expect(link?.getAttribute("href")).toBe("https://stigmer.ai/docs/guides/self-hosting/runners");
    expect(link?.textContent).toBe("runners guide");
    expect(words(container)).toBe("The runners guide lists it.");
  });

  it("links a bare URL, shown without its scheme, leaving the sentence's full stop outside", async () => {
    const container = await drawn("Start here: https://stigmer.ai/docs/getting-started/quickstart.");
    const link = container.querySelector("a");

    expect(link?.getAttribute("href")).toBe("https://stigmer.ai/docs/getting-started/quickstart");
    expect(link?.textContent).toBe("stigmer.ai/docs/getting-started/quickstart");
    expect(words(container)).toBe("Start here: stigmer.ai/docs/getting-started/quickstart.");
  });

  it.each([
    ["a path that only resolves on GitHub", "See [the guide](docs/guides/self-hosting/kubernetes.mdx)."],
    ["a script address", "See [the guide](javascript:alert(1))."],
    ["a mail address", "See [the guide](mailto:someone@example.com)."],
  ])("keeps the words of %s and draws no link", async (_what, markdown) => {
    const container = await drawn(markdown);

    expect(container.querySelector("a")).toBeNull();
    expect(words(container)).toBe("See the guide.");
  });

  it("draws bullets, keeps nested ones under their bullet, and joins a bullet's wrapped lines", async () => {
    const container = await drawn(
      [
        "- **React kit (`@stigmer/react-sdk`)**: a redesign changes the look",
        "  of most parts.",
        "  - Removed: `FileReviewDock`.",
        "  - Changed words: \"Try again\" for \"Retry\".",
        "- **`@stigmer/client`**: `formatElapsed` writes two digits.",
      ].join("\n"),
    );
    const top = [...container.querySelectorAll("div > ul > li")];
    const nested = [...container.querySelectorAll("div > ul > li > ul > li")];

    expect(top).toHaveLength(2);
    expect(nested.map(words)).toEqual(["Removed: FileReviewDock.", 'Changed words: "Try again" for "Retry".']);
    expect(words(top[0])).toMatch(/^React kit \(@stigmer\/react-sdk\): a redesign changes the look of most parts\. Removed:/);
    expect(words(top[1])).toBe("@stigmer/client: formatElapsed writes two digits.");
  });

  it("keeps text in angle brackets and braces as the words they are", async () => {
    const container = await drawn(
      "- The approval card reads Allow / Deny / \"Allow all <class>\"; the control is named \"Change {name}'s role\".",
    );

    expect(words(container)).toBe(
      "The approval card reads Allow / Deny / \"Allow all <class>\"; the control is named \"Change {name}'s role\".",
    );
    expect(container.querySelector("class")).toBeNull();
  });

  it("draws raw HTML in the notes as text, never as elements", async () => {
    const container = await drawn('Before <img src="x" onerror="alert(1)"> after.\n\n<script>alert(1)</script>');

    expect(container.querySelector("img, script")).toBeNull();
    expect(words(container)).toContain('Before <img src="x" onerror="alert(1)"> after.');
  });

  it("draws a numbered list and a code block, which today's notes don't use, as written", async () => {
    const container = await drawn("1. Back up.\n2. Upgrade.\n\n```bash\nstigmer up\n```");

    expect([...container.querySelectorAll("ol > li")].map(words)).toEqual(["Back up.", "Upgrade."]);
    expect(container.querySelector("pre")?.textContent).toBe("stigmer up\n");
  });

  it("makes a code block and a table, which scroll sideways, Tab stops", async () => {
    const container = await drawn("```bash\nstigmer up\n```\n\n| Was | Is |\n| --- | --- |\n| `r2` | `s3` |");
    const table = container.querySelector("table");

    expect(container.querySelector("pre")?.getAttribute("tabindex")).toBe("0");
    expect(container.querySelector("pre")?.className).toContain("overflow-x-auto");
    expect([...(table?.querySelectorAll("th, td") ?? [])].map(words)).toEqual(["Was", "Is", "r2", "s3"]);
    expect(table?.parentElement?.getAttribute("tabindex")).toBe("0");
    expect(table?.parentElement?.className).toContain("overflow-x-auto");
  });

  it("leaves no Markdown mark in the words", async () => {
    const container = await drawn(
      [
        "**Help on every screen.** A server can name where people ask (`STIGMER_HELP_URL`), and [every screen](https://stigmer.ai/docs) shows it.",
        "",
        "- **`@stigmer/client`**: `formatElapsed` writes its second unit in two digits (\"1m 05s\").",
        "  - `TerminalSession` draws no frame by default (`framed` restores it).",
      ].join("\n"),
    );

    expect(container.textContent).not.toMatch(/\*\*|`|\]\(|^\s*- /m);
  });
});
