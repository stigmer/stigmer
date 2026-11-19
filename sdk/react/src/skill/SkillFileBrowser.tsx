"use client";

import { useMemo, useState } from "react";
import Markdown from "react-markdown";
import { cn } from "@stigmer/design-tokens";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { UNSTYLED_LIST } from "../internal/element-resets.js";
import { CodeBlock } from "../internal/CodeBlock.js";
import { MARKDOWN_COMPONENTS, REMARK_PLUGINS, stripFrontmatter } from "../internal/markdown-components.js";
import { buildFileTree, FileTreeNode, type TreeNode } from "../internal/file-tree/index.js";
import { useSkillArtifact } from "./useSkillArtifact.js";
import { LoadingRegion } from "../internal/LoadingRegion.js";
import { ChoiceGroup, Field, Select } from "../internal/form/index.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Props for {@link SkillFileBrowser}. */
export interface SkillFileBrowserProps {
  /** Artifact storage key from `skill.status.artifactStorageKey`. */
  readonly artifactStorageKey: string | null;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * File tree browser with content viewer for skill packages.
 *
 * Fetches the skill's ZIP artifact, unpacks it, and renders:
 * - Left panel: file tree with folder grouping
 * - Right panel: content viewer (rendered Markdown for .md, raw code otherwise)
 *
 * SKILL.md is selected by default on load; packages without a root SKILL.md
 * fall back to the first file in tree order.
 * Responsive: stacked layout on mobile viewports.
 *
 * Zero Console dependencies — safe for platform builder embedding.
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * function SkillFiles() {
 *   const { skill } = useSkill("acme", "code-review");
 *   return <SkillFileBrowser artifactStorageKey={skill?.status?.artifactStorageKey ?? null} />;
 * }
 * ```
 */
export function SkillFileBrowser({
  artifactStorageKey,
  className,
}: SkillFileBrowserProps) {
  const { files, isLoading, error, getFileContent, refetch } = useSkillArtifact(artifactStorageKey);
  // Only the user's explicit click is state; the initial selection is derived
  // from the loaded file list below, so it exists the moment files do.
  const [userSelectedPath, setUserSelectedPath] = useState<string | null>(null);

  const fileEntries = useMemo(
    () => (files ? files.filter((f) => !f.isDirectory) : []),
    [files],
  );

  // SKILL.md is what the agent reads first, so it heads the tree; the rest
  // keep buildFileTree's order.
  const treeNodes = useMemo(() => {
    const nodes = buildFileTree(fileEntries);
    const manifest = nodes.findIndex((node) => node.path === "SKILL.md");
    return manifest <= 0 ? nodes : [nodes[manifest]!, ...nodes.slice(0, manifest), ...nodes.slice(manifest + 1)];
  }, [fileEntries]);

  // Default to the manifest; fall back to the first file in rendered tree
  // order (buildFileTree sorts by localeCompare, and depth-first tree order
  // follows that sort) so the auto-highlighted row is the topmost file.
  const defaultPath = useMemo(() => {
    if (fileEntries.some((f) => f.path === "SKILL.md")) return "SKILL.md";
    const sorted = [...fileEntries].sort((a, b) => a.path.localeCompare(b.path));
    return sorted[0]?.path ?? null;
  }, [fileEntries]);

  const selectedPath = userSelectedPath ?? defaultPath;
  const content = selectedPath !== null ? getFileContent(selectedPath) : null;

  if (!artifactStorageKey) return null;

  if (isLoading) {
    return (
      <LoadingRegion
        className={cn("stg:rounded-lg stg:border stg:border-border", className)}
        label="Loading skill package files"
      >
        <div className="stg:p-4">
          <div className="stg:h-3 stg:w-32 stg:animate-pulse stg:rounded stg:bg-muted" />
        </div>
        <div className="stg:grid stg:grid-cols-1 stg:md:grid-cols-[200px_1fr] stg:border-t stg:border-border">
          <div className="stg:space-y-2 stg:p-3 stg:border-b stg:md:border-b-0 stg:md:border-r stg:border-border">
            {[1, 2, 3].map((i) => (
              <div key={i} className="stg:h-4 stg:w-full stg:animate-pulse stg:rounded stg:bg-muted" />
            ))}
          </div>
          <div className="stg:p-4">
            <div className="stg:space-y-2">
              <div className="stg:h-4 stg:w-3/4 stg:animate-pulse stg:rounded stg:bg-muted" />
              <div className="stg:h-4 stg:w-1/2 stg:animate-pulse stg:rounded stg:bg-muted" />
              <div className="stg:h-4 stg:w-2/3 stg:animate-pulse stg:rounded stg:bg-muted" />
            </div>
          </div>
        </div>
      </LoadingRegion>
    );
  }

  if (error) {
    return <ErrorMessage error={error} title="Couldn't load the skill package." retry={refetch} className={className} />;
  }

  if (!files || files.length === 0) return null;

  // Every folder the tree draws, nested ones included (a/b/c.md is two).
  const folderCount = new Set(
    fileEntries.flatMap((f) => {
      const parts = f.path.split("/").slice(0, -1);
      return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
    }),
  ).size;
  // The phone's file list reads in the tree's order: SKILL.md first, then each folder's files.
  const treePaths = filesInTreeOrder(treeNodes);

  return (
    <div className={cn("stg:flex stg:flex-col stg:gap-3", className)}>
      {/* What the package holds, in one line, and which file the agent reads first. */}
      <p className="stg:m-0 stg:text-xs stg:text-muted-foreground">
        {count(fileEntries.length, "file")}
        {folderCount > 0 ? ` in ${count(folderCount, "folder")}` : ""}
        {fileEntries.some((f) => f.path === "SKILL.md") ? " · SKILL.md is what the agent reads first" : ""}
      </p>

      {/* On a phone the file is picked from a list above the viewer. */}
      <div className="stg:md:hidden">
        <Field label="File">
          <Select value={selectedPath ?? ""} onChange={(e) => setUserSelectedPath(e.target.value)}>
            {treePaths.map((path) => (
              <option key={path} value={path}>
                {path}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {/* The folders and files on the left, the chosen file on the right. */}
      <div className="stg:grid stg:grid-cols-1 stg:overflow-hidden stg:rounded-xl stg:border stg:border-border stg:bg-card stg:md:grid-cols-[224px_minmax(0,1fr)]">
        <nav
          className="stg:hidden stg:overflow-y-auto stg:border-r stg:border-border-muted stg:p-2 stg:md:block"
          aria-label="Files in the skill package"
        >
          <ul className={UNSTYLED_LIST} role="tree">
            {treeNodes.map((node) => (
              <FileTreeNode
                key={node.path}
                node={node}
                selectedPath={selectedPath ?? ""}
                onSelect={setUserSelectedPath}
                depth={0}
              />
            ))}
          </ul>
        </nav>

        <div className="stg:flex stg:min-w-0 stg:flex-col">
          {selectedPath !== null && content !== null ? (
            <FileContentViewer path={selectedPath} content={content} />
          ) : (
            <p className="stg:m-0 stg:p-4 stg:text-sm stg:text-muted-foreground">
              Choose a file to read it.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

// ---------------------------------------------------------------------------
// Content viewer
// ---------------------------------------------------------------------------

function FileContentViewer({
  path,
  content,
}: {
  readonly path: string;
  readonly content: string;
}) {
  const isMarkdown = path.endsWith(".md");
  const [view, setView] = useState<"rendered" | "source">("rendered");
  const lines = content.replace(/\n$/, "").split("\n").length;

  return (
    <>
      {/* The file's own head: its path, then how to read it (Markdown, rendered or as source) or what it is. */}
      <div className="stg:flex stg:min-h-11 stg:flex-wrap stg:items-center stg:justify-between stg:gap-2 stg:border-b stg:border-border-muted stg:px-4 stg:py-2">
        <span className="stg:min-w-0 stg:truncate stg:font-mono stg:text-xs stg:text-foreground">{path}</span>
        {isMarkdown ? (
          <ChoiceGroup
            size="xs"
            aria-label="How to show the file"
            value={view}
            onChange={setView}
            options={[
              { value: "rendered", label: "Rendered" },
              { value: "source", label: "Source" },
            ]}
          />
        ) : (
          <span className="stg:text-xs stg:text-muted-foreground">{count(lines, "line")}</span>
        )}
      </div>
      <div className="stg:max-h-[480px] stg:min-w-0 stg:overflow-auto stg:p-4">
        {isMarkdown && view === "rendered" ? (
          <Markdown remarkPlugins={REMARK_PLUGINS} components={MARKDOWN_COMPONENTS}>
            {stripFrontmatter(content)}
          </Markdown>
        ) : (
          <CodeBlock frame="bare">{content}</CodeBlock>
        )}
      </div>
    </>
  );
}

/** Every file's path, in the order the tree draws it. */
function filesInTreeOrder(nodes: readonly TreeNode[]): string[] {
  return nodes.flatMap((node) => (node.children ? filesInTreeOrder(node.children) : [node.path]));
}
