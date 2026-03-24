/**
 * Remark plugin that converts fenced mermaid code blocks into
 * `<Mermaid chart="..." />` MDX JSX elements.
 *
 * This runs in the remark (MDAST) phase, before rehype and Shiki,
 * so mermaid blocks are never syntax-highlighted as code. Instead
 * they are rendered as interactive diagrams by the client-side
 * Mermaid component.
 */
import type { Root, Code } from "mdast";
import type { Plugin } from "unified";
import { visit } from "unist-util-visit";

const remarkMermaid: Plugin<[], Root> = () => {
  return (tree) => {
    visit(tree, "code", (node: Code, index, parent) => {
      if (node.lang !== "mermaid" || index === undefined || !parent) return;

      // Replace the code node with an MDX JSX element: <Mermaid chart="..." />
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (parent.children as any[])[index] = {
        type: "mdxJsxFlowElement",
        name: "Mermaid",
        attributes: [
          {
            type: "mdxJsxAttribute",
            name: "chart",
            value: node.value,
          },
        ],
        children: [],
        data: { _mdxExplicitJsx: true },
      };
    });
  };
};

export default remarkMermaid;
