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
 * SKILL.md is selected by default on load.
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
  const [selectedPath, setSelectedPath] = useState<string>("SKILL.md");

  const treeNodes = useMemo(
    () => (files ? buildFileTree(files.filter((f) => !f.isDirectory)) : []),
    [files],
  );

  const content = useMemo(
    () => (selectedPath ? getFileContent(selectedPath) : null),
    [selectedPath, getFileContent],
  );

  if (!artifactStorageKey) return null;

  if (isLoading) {
    return (
      <div
        className={cn("rounded-lg border border-border", className)}
        aria-busy="true"
        aria-label="Loading skill package files"
      >
        <div className="p-4">
          <div className="h-3 w-32 animate-pulse rounded bg-muted" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] border-t border-border">
          <div className="space-y-2 p-3 border-b md:border-b-0 md:border-r border-border">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-4 w-full animate-pulse rounded bg-muted" />
            ))}
          </div>
          <div className="p-4">
            <div className="space-y-2">
              <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
              <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
              <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn("rounded-lg border border-border p-4", className)}>
        <p className="text-sm text-destructive">
          Failed to load skill package: {error.message}
        </p>
      </div>
    );
  }

  if (!files || files.length === 0) return null;

  return (
    <div className={cn("rounded-lg border border-border overflow-hidden", className)}>
      {/* Header */}
      <div className="border-b border-border px-4 py-2">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Package Files
        </h3>
      </div>

      {/* Split pane */}
      <div className="grid grid-cols-1 md:grid-cols-[220px_1fr]">
        {/* File tree */}
        <nav
          className="border-b border-border md:border-b-0 md:border-r overflow-y-auto"
          aria-label="Skill package file tree"
        >
          <ul className="py-1" role="tree">
            {treeNodes.map((node) => (
              <FileTreeNode
                key={node.path}
                node={node}
                selectedPath={selectedPath}
                onSelect={setSelectedPath}
                depth={0}
              />
            ))}
          </ul>
        </nav>

        {/* Content viewer */}
        <div className="min-h-[200px] max-h-[400px] overflow-y-auto p-4">
          {content !== null ? (
            <FileContentViewer path={selectedPath} content={content} />
          ) : (
            <p className="text-sm text-muted-foreground-subtle italic">
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
    <pre className="overflow-x-auto font-mono text-xs leading-relaxed text-foreground whitespace-pre-wrap">
      {content}
    </pre>
  );
}

