"use client";

import { useState, useRef, useEffect } from "react";
import { cn } from "@stigmer/theme";
import type { ExportFormat } from "./useExportCSV.js";

/** Props for {@link ExportButton}. */
export interface ExportButtonProps {
  /** Callback invoked with the selected export format. */
  readonly onExport: (format: ExportFormat) => void;
  /** Whether an export is in progress. */
  readonly isExporting?: boolean;
  /** Disable the button (e.g., when no data is loaded). */
  readonly disabled?: boolean;
  /** Additional CSS class names. */
  readonly className?: string;
}

/**
 * Dropdown button for exporting usage data as CSV.
 *
 * Presents two options: "Daily Summary" and "Model Breakdown",
 * corresponding to the two CSV export formats.
 */
export function ExportButton({
  onExport,
  isExporting,
  disabled,
  className,
}: ExportButtonProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div ref={ref} className={cn("stg:relative", className)}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={disabled || isExporting}
        className={cn(
          "stg:inline-flex stg:items-center stg:gap-1.5 stg:rounded-md stg:border stg:border-border stg:px-2.5 stg:py-1 stg:text-xs stg:font-medium stg:transition-colors",
          "stg:text-muted-foreground stg:hover:text-foreground stg:hover:bg-accent",
          "stg:disabled:pointer-events-none stg:disabled:opacity-50",
        )}
        aria-expanded={open}
        aria-haspopup="true"
      >
        <DownloadIcon className="stg:size-3.5" />
        {isExporting ? "Exporting…" : "Export"}
      </button>

      {open && (
        <div
          className="stg:absolute stg:right-0 stg:top-full stg:z-10 stg:mt-1 stg:w-44 stg:rounded-md stg:border stg:border-border stg:bg-popover stg:py-1 stg:shadow-md"
          role="menu"
        >
          <button
            type="button"
            role="menuitem"
            className="stg:w-full stg:px-3 stg:py-1.5 stg:text-left stg:text-xs stg:text-popover-foreground stg:hover:bg-accent"
            onClick={() => {
              onExport("daily_summary");
              setOpen(false);
            }}
          >
            Daily Summary
          </button>
          <button
            type="button"
            role="menuitem"
            className="stg:w-full stg:px-3 stg:py-1.5 stg:text-left stg:text-xs stg:text-popover-foreground stg:hover:bg-accent"
            onClick={() => {
              onExport("model_breakdown");
              setOpen(false);
            }}
          >
            Model Breakdown
          </button>
        </div>
      )}
    </div>
  );
}

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}
