/**
 * Remark plugin that hides a code example's setup from the reader.
 *
 * A TypeScript, Go, Python or Java fence may open with setup lines ended by
 * a `---cut---` marker line (`// ---cut---`, `# ---cut---` in Python): the
 * declarations the docs snippet gate needs to compile the example, such as
 * a `user` the page's prose introduced (docs/STYLE.md, "Code examples").
 * This plugin drops them and the marker in the remark (MDAST) phase, before
 * Shiki highlights the block, so neither the rendered block nor its copy
 * button carries them. The split is the one the gate and the markdown
 * exports make (./snippet-setup.mjs), so the three cannot disagree.
 */
import type { Code, Root } from "mdast";
import type { Plugin } from "unified";
import { visit } from "unist-util-visit";
import { splitSnippetSetup } from "./snippet-setup.mjs";

/** The setup-free text of every code node in `tree`, in place. */
export function hideSnippetSetup(tree: Root): void {
  visit(tree, "code", (node: Code) => {
    node.value = splitSnippetSetup(node.lang, node.value).body;
  });
}

const remarkSnippetSetup: Plugin<[], Root> = () => hideSnippetSetup;

export default remarkSnippetSetup;
