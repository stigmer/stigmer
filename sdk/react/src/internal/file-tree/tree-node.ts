/** A node in a hierarchical file tree. Folders have `children`; files do not. */
export interface TreeNode {
  name: string;
  path: string;
  children?: TreeNode[];
}

/**
 * Builds a hierarchical {@link TreeNode} array from a flat list of file paths.
 *
 * Intermediate folder nodes are synthesized automatically from the path
 * segments. The input is sorted lexicographically before insertion so the
 * resulting tree is deterministic regardless of input order.
 *
 * The input contract is intentionally minimal — any object with a `path`
 * string works, allowing both `SkillFileEntry` and `WorkspaceFileEntry`
 * to use this utility without adaptation.
 */
export function buildFileTree(files: ReadonlyArray<{ readonly path: string }>): TreeNode[] {
  const root: TreeNode[] = [];

  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));

  for (const file of sorted) {
    const parts = file.path.split("/");

    if (parts.length === 1) {
      root.push({ name: parts[0], path: file.path });
    } else {
      let currentLevel = root;
      for (let i = 0; i < parts.length - 1; i++) {
        const folderName = parts[i];
        let folder = currentLevel.find(
          (n) => n.name === folderName && n.children,
        );
        if (!folder) {
          folder = {
            name: folderName,
            path: parts.slice(0, i + 1).join("/") + "/",
            children: [],
          };
          currentLevel.push(folder);
        }
        currentLevel = folder.children!;
      }
      currentLevel.push({ name: parts[parts.length - 1], path: file.path });
    }
  }

  return root;
}
