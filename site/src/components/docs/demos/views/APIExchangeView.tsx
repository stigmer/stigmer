"use client";

import { motion } from "framer-motion";
import {
  ArrowRight,
  Check,
  ChevronRight,
  Loader2,
  Network,
  X,
} from "lucide-react";
import {
  DEMO_SHELL_HEIGHT,
  DEMO_SHELL_HEIGHT_MIN,
} from "../shared/tokens";

export interface CheckItem {
  readonly label: string;
  readonly detail?: string;
  readonly status: "pass" | "fail" | "pending";
}

interface APIExchangeViewProps {
  readonly title?: string;
  readonly request?: {
    readonly method: string;
    readonly url: string;
    readonly header?: string;
  };
  readonly checks?: readonly CheckItem[];
  readonly result?: {
    readonly label: string;
    readonly detail?: string;
    readonly status: "pass" | "fail";
  };
  readonly contentKey: string;
  readonly slideDirection?: "forward" | "backward";
}

const STATUS_ICON = {
  pass: <Check className="h-3 w-3 text-emerald-400" />,
  fail: <X className="h-3 w-3 text-red-400" />,
  pending: <Loader2 className="h-3 w-3 animate-spin text-[#9aa0a6]" />,
} as const;

/**
 * DevTools-style network/API inspector panel for demo scenarios.
 *
 * Renders a Chrome DevTools-like interface showing an inbound request,
 * a validation pipeline with pass/fail indicators, and a response
 * status card. Used to illustrate Stigmer API processing during
 * token validation, identity resolution, and authorization.
 */
export function APIExchangeView({
  title = "Stigmer API",
  request,
  checks,
  result,
  contentKey,
  slideDirection,
}: APIExchangeViewProps) {
  const slideX =
    slideDirection === "forward" ? 24 : slideDirection === "backward" ? -24 : 0;

  return (
    <div
      className="flex flex-col overflow-hidden rounded-lg border border-border"
      style={{
        height: `var(--demo-shell-height, clamp(${DEMO_SHELL_HEIGHT_MIN}px, 55vh, ${DEMO_SHELL_HEIGHT}px))`,
      }}
    >
      {/* DevTools header bar */}
      <div className="flex items-center border-b border-[#3c4043] bg-[#202124]">
        <div className="flex items-center gap-3 px-3 text-[10px]">
          {["Elements", "Console", "Network", "Application"].map((tab) => (
            <span
              key={tab}
              className={
                tab === "Network"
                  ? "border-b-2 border-[#8ab4f8] py-1.5 font-medium text-[#8ab4f8]"
                  : "py-1.5 text-[#9aa0a6]"
              }
            >
              {tab}
            </span>
          ))}
        </div>
        <div className="flex-1" />
        <X className="mr-2 h-3 w-3 text-[#9aa0a6]" />
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-[#3c4043] bg-[#292a2d] px-3 py-1.5">
        <Network className="h-3 w-3 text-[#9aa0a6]" />
        <span className="text-[10px] font-medium text-[#e8eaed]">{title}</span>
        <div className="flex-1" />
        <span className="text-[9px] text-[#9aa0a6]">
          {checks?.length ?? 0} checks
        </span>
      </div>

      {/* Content */}
      <motion.div
        key={contentKey}
        className="flex-1 overflow-y-auto bg-[#1e1e1e] p-3"
        initial={{ opacity: 0, x: slideX }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
      >
        {/* Request */}
        {request && (
          <div className="mb-3 rounded border border-[#3c4043] bg-[#292a2d]">
            <div className="border-b border-[#3c4043] px-3 py-1.5">
              <span className="text-[9px] font-medium uppercase tracking-wider text-[#9aa0a6]">
                Request
              </span>
            </div>
            <div className="px-3 py-2">
              <div className="flex items-center gap-2 font-mono text-[10px]">
                <span className="rounded bg-[#8ab4f8]/15 px-1.5 py-0.5 text-[9px] font-bold text-[#8ab4f8]">
                  {request.method}
                </span>
                <span className="text-[#e8eaed]">{request.url}</span>
              </div>
              {request.header && (
                <div className="mt-1.5 flex items-center gap-1.5 font-mono text-[9px] text-[#9aa0a6]">
                  <ChevronRight className="h-2 w-2 shrink-0" />
                  <span className="truncate">{request.header}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Validation pipeline */}
        {checks && checks.length > 0 && (
          <div className="mb-3 rounded border border-[#3c4043] bg-[#292a2d]">
            <div className="border-b border-[#3c4043] px-3 py-1.5">
              <span className="text-[9px] font-medium uppercase tracking-wider text-[#9aa0a6]">
                Validation Pipeline
              </span>
            </div>
            <div className="divide-y divide-[#3c4043]">
              {checks.map((check, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2.5 px-3 py-2"
                  data-cursor-target={`check-${i}`}
                >
                  {/* Step number */}
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#3c4043] text-[8px] font-medium text-[#9aa0a6]">
                    {i + 1}
                  </span>

                  {/* Arrow connector (except first) */}
                  {i > 0 && (
                    <ArrowRight className="hidden h-2.5 w-2.5 text-[#5f6368]" />
                  )}

                  {/* Status icon */}
                  {STATUS_ICON[check.status]}

                  {/* Label + detail */}
                  <div className="min-w-0 flex-1">
                    <span className="text-[10px] font-medium text-[#e8eaed]">
                      {check.label}
                    </span>
                    {check.detail && (
                      <span className="ml-1.5 font-mono text-[9px] text-[#9aa0a6]">
                        {check.detail}
                      </span>
                    )}
                  </div>

                  {/* Timing placeholder */}
                  <span className="shrink-0 text-[8px] text-[#5f6368]">
                    {check.status === "pass" ? `${2 + i}ms` : "—"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Response */}
        {result && (
          <div
            className={`rounded border ${
              result.status === "pass"
                ? "border-emerald-500/30 bg-emerald-500/5"
                : "border-red-500/30 bg-red-500/5"
            }`}
          >
            <div
              className={`border-b px-3 py-1.5 ${
                result.status === "pass"
                  ? "border-emerald-500/20"
                  : "border-red-500/20"
              }`}
            >
              <span className="text-[9px] font-medium uppercase tracking-wider text-[#9aa0a6]">
                Response
              </span>
            </div>
            <div className="flex items-center gap-2 px-3 py-2">
              {result.status === "pass" ? (
                <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
              ) : (
                <X className="h-3.5 w-3.5 shrink-0 text-red-400" />
              )}
              <span
                className={`text-[10px] font-semibold ${
                  result.status === "pass"
                    ? "text-emerald-400"
                    : "text-red-400"
                }`}
              >
                {result.label}
              </span>
            </div>
            {result.detail && (
              <div className="border-t border-[#3c4043]/50 px-3 py-1.5 font-mono text-[9px] text-[#9aa0a6]">
                {result.detail}
              </div>
            )}
          </div>
        )}
      </motion.div>
    </div>
  );
}
