"use client";

import { motion } from "framer-motion";
import {
  ChevronDown,
  Copy,
  FileCode2,
  FileJson,
  FolderOpen,
  GitBranch,
  LayoutGrid,
  Search,
  Settings,
} from "lucide-react";
import { DEMO_SHELL_HEIGHT } from "../shared/tokens";

export interface FileTreeEntry {
  readonly name: string;
  readonly type: "folder" | "file";
  /** Nesting depth (0 = root level). */
  readonly depth: number;
}

interface CodeEditorViewProps {
  readonly filename: string;
  readonly lines: readonly string[];
  /** 0-based line indices to highlight with a gutter accent. */
  readonly highlightLines?: readonly number[];
  /** Optional file explorer sidebar entries. */
  readonly fileTree?: readonly FileTreeEntry[];
  /** Workspace folder name shown in the title bar and explorer. Defaults to `stigmer-federation`. */
  readonly workspaceName?: string;
  readonly contentKey: string;
  readonly slideDirection?: "forward" | "backward";
}

function fileIcon(name: string) {
  if (name.endsWith(".json"))
    return <FileJson className="h-3 w-3 shrink-0 text-[#e6995b]" />;
  if (name.endsWith(".ts") || name.endsWith(".tsx"))
    return <FileCode2 className="h-3 w-3 shrink-0 text-[#519aba]" />;
  return <FileCode2 className="h-3 w-3 shrink-0 text-[#858585]" />;
}

/**
 * Schematic VS Code-style code editor for demo scenarios.
 *
 * Renders a full IDE layout: activity bar, file explorer sidebar,
 * file tab bar, line number gutter, and monospace code area on a
 * dark background. The explorer includes indentation guides and
 * highlights the active file.
 */
export function CodeEditorView({
  filename,
  lines,
  highlightLines,
  fileTree,
  workspaceName = "stigmer-federation",
  contentKey,
  slideDirection,
}: CodeEditorViewProps) {
  const slideX =
    slideDirection === "forward" ? 24 : slideDirection === "backward" ? -24 : 0;

  const highlightSet = new Set(highlightLines);

  return (
    <div
      className="flex flex-col overflow-hidden rounded-lg border border-border"
      style={{ height: `var(--demo-shell-height, ${DEMO_SHELL_HEIGHT}px)` }}
    >
      {/* Title bar */}
      {fileTree && (
        <div className="flex items-center border-b border-[#1e1e1e] bg-[#323233] px-3 py-1">
          <div className="flex gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#ff5f57]" />
            <span className="h-2 w-2 rounded-full bg-[#febc2e]" />
            <span className="h-2 w-2 rounded-full bg-[#28c840]" />
          </div>
          <span className="flex-1 text-center text-[9px] text-[#9d9d9d]">
            {filename} — {workspaceName}
          </span>
          <div className="w-[42px]" />
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Activity bar */}
        {fileTree && (
          <div className="flex w-7 shrink-0 flex-col items-center gap-2.5 border-r border-[#2d2d2d] bg-[#333333] py-2">
            <Copy className="h-3.5 w-3.5 text-[#ffffff]" />
            <Search className="h-3.5 w-3.5 text-[#858585]" />
            <GitBranch className="h-3.5 w-3.5 text-[#858585]" />
            <LayoutGrid className="h-3.5 w-3.5 text-[#858585]" />
            <div className="flex-1" />
            <Settings className="h-3.5 w-3.5 text-[#858585]" />
          </div>
        )}

        {/* File explorer panel */}
        {fileTree && (
          <div className="flex w-[150px] shrink-0 flex-col border-r border-[#2d2d2d] bg-[#252526]">
            <div className="px-3 py-1.5 text-[9px] font-semibold uppercase tracking-wider text-[#cccccc]">
              Explorer
            </div>
            <div className="px-1.5 pb-1 text-[9px] font-semibold text-[#cccccc]">
              <ChevronDown className="mr-0.5 inline h-2.5 w-2.5" />
              {workspaceName}
            </div>
            <div className="flex-1 overflow-y-auto">
              {fileTree.map((entry, i) => {
                const isActive =
                  entry.type === "file" && entry.name === filename;
                return (
                  <div
                    key={i}
                    className={`relative flex items-center gap-1 py-[2px] pr-2 text-[10px] leading-[18px] ${
                      isActive
                        ? "bg-[#04395e] text-[#ffffff]"
                        : "text-[#cccccc]"
                    }`}
                    style={{ paddingLeft: `${12 + entry.depth * 12}px` }}
                  >
                    {/* Indentation guides */}
                    {entry.depth > 0 &&
                      Array.from({ length: entry.depth }, (_, d) => (
                        <span
                          key={d}
                          className="absolute top-0 bottom-0 w-px bg-[#404040]"
                          style={{ left: `${12 + d * 12}px` }}
                        />
                      ))}

                    {entry.type === "folder" ? (
                      <>
                        <ChevronDown className="h-3 w-3 shrink-0 text-[#cccccc]" />
                        <FolderOpen className="h-3 w-3 shrink-0 text-[#dcb67a]" />
                      </>
                    ) : (
                      <>
                        <span className="w-3 shrink-0" />
                        {fileIcon(entry.name)}
                      </>
                    )}
                    <span className="truncate">{entry.name}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Editor pane */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Tab bar */}
          <div className="flex items-end border-b border-[#1e1e1e] bg-[#252526]">
            <div className="flex items-center gap-1.5 border-b-2 border-[#007acc] bg-[#1e1e1e] px-3 py-1.5">
              {fileIcon(filename)}
              <span className="text-[10px] text-[#cccccc]">{filename}</span>
            </div>
            <div className="flex-1" />
          </div>

          {/* Code area */}
          <motion.div
            key={contentKey}
            className="flex flex-1 overflow-y-auto bg-[#1e1e1e] font-mono text-[11px] leading-[1.6]"
            initial={{ opacity: 0, x: slideX }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          >
            {/* Line numbers */}
            <div
              className="sticky left-0 shrink-0 select-none bg-[#1e1e1e] py-2 pr-2 text-right"
              aria-hidden
            >
              {lines.map((_, i) => (
                <div
                  key={i}
                  className={`flex items-center justify-end px-2 ${
                    highlightSet.has(i)
                      ? "border-l-2 border-[#007acc] text-[#c6c6c6]"
                      : "border-l-2 border-transparent text-[#858585]"
                  }`}
                >
                  {i + 1}
                </div>
              ))}
            </div>

            {/* Code content */}
            <div className="min-w-0 flex-1 py-2 pr-4">
              {lines.map((line, i) => (
                <div
                  key={i}
                  className={`whitespace-pre px-2 ${
                    highlightSet.has(i)
                      ? "bg-[#007acc]/10 text-[#d4d4d4]"
                      : "text-[#d4d4d4]"
                  }`}
                >
                  {line || "\u00A0"}
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
