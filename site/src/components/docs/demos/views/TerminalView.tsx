"use client";

import { motion } from "framer-motion";
import { ChevronDown, ChevronRight, Plus, X } from "lucide-react";
import {
  DEMO_SHELL_HEIGHT,
  DEMO_SHELL_HEIGHT_MIN,
} from "../shared/tokens";

export interface TerminalLine {
  readonly type: "prompt" | "output" | "error" | "success" | "blank";
  readonly text: string;
}

interface TerminalViewProps {
  readonly title?: string;
  /** Working directory shown in the prompt. Defaults to `~/stigmer-federation`. */
  readonly cwd?: string;
  readonly lines: readonly TerminalLine[];
  readonly contentKey: string;
  readonly slideDirection?: "forward" | "backward";
}

/**
 * macOS Terminal / iTerm2-style terminal emulator for demo scenarios.
 *
 * Renders a realistic terminal with:
 * - macOS title bar with traffic lights, shell type, and working directory
 * - Tab bar with active tab
 * - Dark monospace content area with colored prompt lines
 *
 * Line colors are fixed (not theme-dependent) since terminals are
 * always dark.
 */
export function TerminalView({
  title = "Terminal",
  cwd = "~/stigmer-federation",
  lines,
  contentKey,
  slideDirection,
}: TerminalViewProps) {
  const slideX =
    slideDirection === "forward" ? 24 : slideDirection === "backward" ? -24 : 0;

  return (
    <div
      className="flex flex-col overflow-hidden rounded-lg border border-[#3a3a3a]"
      style={{
        height: `var(--demo-shell-height, clamp(${DEMO_SHELL_HEIGHT_MIN}px, 55vh, ${DEMO_SHELL_HEIGHT}px))`,
      }}
    >
      {/* Title bar */}
      <div className="flex items-center bg-[#323232] px-3 py-1.5">
        <div className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        </div>
        <span className="flex-1 text-center text-[10px] text-[#a0a0a0]">
          {title}
        </span>
        <div className="w-[42px]" />
      </div>

      {/* Tab bar */}
      <div className="flex items-center border-b border-[#1a1a1a] bg-[#2d2d2d]">
        {/* Active tab */}
        <div className="flex items-center gap-1.5 border-r border-[#1a1a1a] bg-[#1e1e1e] px-3 py-1">
          <ChevronRight className="h-2 w-2 text-[#50fa7b]" />
          <span className="text-[9px] text-[#cccccc]">zsh</span>
          <X className="h-2 w-2 text-[#666666]" />
        </div>
        {/* New tab button */}
        <div className="px-2">
          <Plus className="h-2.5 w-2.5 text-[#666666]" />
        </div>
        <div className="flex-1" />
        {/* Shell indicator */}
        <div className="flex items-center gap-1 pr-3">
          <ChevronDown className="h-2.5 w-2.5 text-[#666666]" />
        </div>
      </div>

      {/* Terminal content */}
      <motion.div
        key={contentKey}
        className="flex-1 overflow-y-auto bg-[#1e1e1e] px-3 py-2 font-mono text-[11px] leading-relaxed"
        initial={{ opacity: 0, x: slideX }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
      >
        {lines.map((line, i) => {
          if (line.type === "blank") {
            return <div key={i} className="h-3" />;
          }

          const colorClass = {
            prompt: "text-[#f8f8f2]",
            output: "text-[#f8f8f2]/70",
            error: "text-[#ff5555]",
            success: "text-[#50fa7b]",
          }[line.type];

          return (
            <div key={i} className={colorClass}>
              {line.type === "prompt" && (
                <span className="mr-1 text-[#bd93f9]">
                  {cwd}
                </span>
              )}
              {line.type === "prompt" && (
                <span className="mr-1.5 text-[#50fa7b]">❯</span>
              )}
              <span className="whitespace-pre-wrap">{line.text}</span>
            </div>
          );
        })}
      </motion.div>
    </div>
  );
}
