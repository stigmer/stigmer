import type { TreeNode } from "./tree-node";

/**
 * Filters a {@link TreeNode} hierarchy by a search query.
 *
 * Returns a new tree containing only nodes whose `name` matches
 * the query (case-insensitive substring), plus all ancestor folders
 * needed to preserve the hierarchy. Folder nodes that match are
 * included with all their original children (the match implies the
 * entire subtree is relevant). Folder nodes that do not match
 * themselves are included only when they contain matching descendants.
 *
 * Returns the original `tree` reference when `query` is empty or
 * whitespace-only, preserving referential stability for downstream
 * `React.memo` consumers.
 */
export function filterFileTree(
  tree: readonly TreeNode[],
  query: string,
): readonly TreeNode[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) return tree;

  const lower = trimmed.toLowerCase();
  return filterNodes(tree, lower);
}

function filterNodes(
  nodes: readonly TreeNode[],
  query: string,
): TreeNode[] {
  const result: TreeNode[] = [];

  for (const node of nodes) {
    const nameMatches = node.name.toLowerCase().includes(query);

    if (node.children) {
      if (nameMatches) {
        result.push(node);
      } else {
        const filteredChildren = filterNodes(node.children, query);
        if (filteredChildren.length > 0) {
          result.push({ ...node, children: filteredChildren });
        }
      }
    } else {
      if (nameMatches) {
        result.push(node);
      }
    }
  }

  return result;
}
