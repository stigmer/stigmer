"use client";

import { useMemo, useState } from "react";
import Markdown from "react-markdown";
import { cn } from "@stigmer/theme";
import { MARKDOWN_COMPONENTS, REMARK_PLUGINS, stripFrontmatter } from "../internal/markdown-components.js";
import { buildFileTree, FileTreeNode } from "../internal/file-tree/index.js";
import { useSkillArtifact } from "./useSkillArtifact.js";

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
 * const { skill } = useSkill(org, slug);
 *
 * <SkillFileBrowser
 *   artifactStorageKey={skill?.status?.artifactStorageKey ?? null}
 * />
 * ```
 */
export function SkillFileBrowser({
  artifactStorageKey,
  className,
}: SkillFileBrowserProps) {
  const { files, isLoading, error, getFileContent } = useSkillArtifact(artifactStorageKey);
  // Only the user's explicit click is state; the initial selection is derived
  // from the loaded file list below, so it exists the moment files do.
  const [userSelectedPath, setUserSelectedPath] = useState<string | null>(null);

  const fileEntries = useMemo(
    () => (files ? files.filter((f) => !f.isDirectory) : []),
    [files],
  );

  const treeNodes = useMemo(() => buildFileTree(fileEntries), [fileEntries]);

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
      <div
        className={cn("stg:rounded-lg stg:border stg:border-border", className)}
        aria-busy="true"
        aria-label="Loading skill package files"
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
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn("stg:rounded-lg stg:border stg:border-border stg:p-4", className)}>
        <p className="stg:text-sm stg:text-destructive">
          Failed to load skill package: {error.message}
        </p>
      </div>
    );
  }

  if (!files || files.length === 0) return null;

  return (
    <div className={cn("stg:rounded-lg stg:border stg:border-border stg:overflow-hidden", className)}>
      {/* Header */}
      <div className="stg:border-b stg:border-border stg:px-4 stg:py-2">
        <h3 className="stg:text-xs stg:font-medium stg:uppercase stg:tracking-wider stg:text-muted-foreground">
          Package Files
        </h3>
      </div>

      {/* Split pane */}
      <div className="stg:grid stg:grid-cols-1 stg:md:grid-cols-[220px_1fr]">
        {/* File tree */}
        <nav
          className="stg:border-b stg:border-border stg:md:border-b-0 stg:md:border-r stg:overflow-y-auto"
          aria-label="Skill package file tree"
        >
          <ul className="stg:py-1" role="tree">
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

        {/* Content viewer */}
        <div className="stg:min-h-[200px] stg:max-h-[400px] stg:overflow-y-auto stg:p-4">
          {selectedPath !== null && content !== null ? (
            <FileContentViewer path={selectedPath} content={content} />
          ) : (
            <p className="stg:text-sm stg:text-muted-foreground-subtle stg:italic">
              Select a file to view its contents
            </p>
          )}
        </div>
      </div>
    </div>
  );
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

  if (isMarkdown) {
    return (
      <Markdown remarkPlugins={REMARK_PLUGINS} components={MARKDOWN_COMPONENTS}>
        {stripFrontmatter(content)}
      </Markdown>
    );
  }

  return (
    <pre className="stg:overflow-x-auto stg:font-mono stg:text-xs stg:leading-relaxed stg:text-foreground stg:whitespace-pre-wrap">
      {content}
    </pre>
  );
}

