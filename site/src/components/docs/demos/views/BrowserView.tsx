"use client";

import { type ReactNode } from "react";
import { motion } from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  Globe,
  Lock,
  RotateCcw,
  X,
} from "lucide-react";
import { DEMO_BROWSER_SHELL_HEIGHT } from "../shared/tokens";

interface BrowserViewProps {
  readonly url: string;
  readonly contentKey: string;
  readonly slideDirection?: "forward" | "backward";
  readonly children: ReactNode;
  /** Optional CSS zoom applied to the entire shell (chrome + content). */
  readonly zoom?: number;
}

function tabTitle(url: string): string {
  const cleaned = url.replace(/^https?:\/\//, "");
  const host = cleaned.split("/")[0] ?? cleaned;
  return host;
}

/**
 * Chrome-style browser chrome for demo scenarios.
 *
 * Renders a realistic tab strip with traffic-light dots, an active tab,
 * a navigation toolbar with back/forward/reload and address bar, and
 * a content area for arbitrary children.
 */
export function BrowserView({
  url,
  contentKey,
  slideDirection,
  children,
  zoom,
}: BrowserViewProps) {
  const slideX =
    slideDirection === "forward" ? 24 : slideDirection === "backward" ? -24 : 0;

  return (
    <div
      className="flex flex-col overflow-hidden rounded-lg border border-border"
      style={{
        height: `var(--demo-shell-height, ${DEMO_BROWSER_SHELL_HEIGHT}px)`,
        zoom: zoom ?? undefined,
      }}
    >
      {/* Tab strip */}
      <div className="flex items-center bg-[#202124] px-2 pt-1.5 dark:bg-[#202124]">
        {/* Traffic lights */}
        <div className="mr-3 flex gap-1.5 pl-1">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        </div>

        {/* Active tab */}
        <div className="flex items-center gap-1.5 rounded-t-lg bg-[#35363a] px-3 py-1.5 dark:bg-[#35363a]">
          <Globe className="h-2.5 w-2.5 shrink-0 text-[#9aa0a6]" />
          <span className="max-w-[140px] truncate text-[10px] text-[#e8eaed]">
            {tabTitle(url)}
          </span>
          <X className="h-2.5 w-2.5 shrink-0 text-[#9aa0a6]" />
        </div>

        <div className="flex-1" />
      </div>

      {/* Navigation toolbar */}
      <div className="flex items-center gap-1.5 bg-[#35363a] px-2 py-1.5 dark:bg-[#35363a]">
        {/* Nav buttons */}
        <div className="flex items-center gap-0.5">
          <ChevronLeft className="h-3.5 w-3.5 text-[#9aa0a6]" />
          <ChevronRight className="h-3.5 w-3.5 text-[#9aa0a6]" />
          <RotateCcw className="ml-0.5 h-3 w-3 text-[#9aa0a6]" />
        </div>

        {/* Address bar */}
        <div className="flex flex-1 items-center gap-1.5 rounded-full bg-[#202124] px-3 py-1">
          <Lock className="h-2.5 w-2.5 shrink-0 text-[#9aa0a6]" />
          <span className="truncate text-[10px] text-[#bdc1c6]">{url}</span>
        </div>

        {/* Extension placeholder */}
        <div className="flex gap-1">
          <div className="h-3.5 w-3.5 rounded-full bg-[#5f6368]" />
        </div>
      </div>

      {/* Page content */}
      <motion.div
        key={contentKey}
        className="flex-1 overflow-y-auto bg-background"
        initial={{ opacity: 0, x: slideX }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
      >
        {children}
      </motion.div>
    </div>
  );
}
