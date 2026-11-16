"use client";

// The place a person drops a file or chooses one: a dashed zone with its
// words, its limit, and a Choose a file button that opens the system's
// picker through the hidden input. The button is the zone's keyboard way in.
// Dragging a file over it draws the zone in the foreground; a refused file
// draws its border in the failed hue, and the form says why under it.

import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { cn } from "@stigmer/design-tokens";
import { Upload } from "lucide-react";
import { Button } from "../../button/Button.js";
import { HiddenFileInput } from "./controls.js";

/** Props for {@link FileDrop}. */
export interface FileDropProps {
  /** Called with the dropped or chosen files. */
  readonly onFiles: (files: File[]) => void;
  /** What to drop ("Drop a skill's .zip here"). */
  readonly title: ReactNode;
  /** The line under it: what's accepted and how big. */
  readonly hint?: ReactNode;
  /** The button's words (default "Choose a file"). */
  readonly actionLabel?: string;
  /** The file types the picker offers, as the input's `accept`. */
  readonly accept?: string;
  readonly multiple?: boolean;
  readonly disabled?: boolean;
  /** Draws the border in the failed hue: the last file was refused. */
  readonly invalid?: boolean;
  /** Replaces the default upload icon. */
  readonly icon?: ReactNode;
  readonly className?: string;
  /** Extra content under the button (a link to an example, a second way in). */
  readonly children?: ReactNode;
  /** The hidden input's accessible name. */
  readonly "aria-label"?: string;
}

/** A zone to drop a file on, with a Choose a file button for the keyboard and the picker. */
export function FileDrop({
  onFiles,
  title,
  hint,
  actionLabel = "Choose a file",
  accept,
  multiple,
  disabled,
  invalid,
  icon,
  className,
  children,
  ...aria
}: FileDropProps) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  function take(list: FileList | null) {
    const files = list === null ? [] : Array.from(list);
    if (files.length > 0) onFiles(multiple ? files : files.slice(0, 1));
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setOver(false);
    if (!disabled) take(e.dataTransfer.files);
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cn(
        "stg:flex stg:flex-col stg:items-center stg:gap-2 stg:rounded-xl stg:border stg:border-dashed stg:p-6 stg:text-center",
        over
          ? "stg:border-foreground stg:bg-accent"
          : invalid
            ? "stg:border-status-failed stg:bg-faint"
            : "stg:border-border-strong stg:bg-faint",
        disabled && "stg:opacity-50",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="stg:grid stg:size-10 stg:place-items-center stg:rounded-xl stg:bg-muted stg:text-foreground"
      >
        {icon ?? <Upload className="stg:size-5" />}
      </span>
      <span className="stg:text-sm stg:font-medium stg:text-foreground">
        {over ? "Drop it to upload" : title}
      </span>
      {hint !== undefined && (
        <span className="stg:text-xs stg:text-muted-foreground">{hint}</span>
      )}
      <Button
        variant="outline"
        onClick={() => input.current?.click()}
        disabled={disabled}
      >
        {actionLabel}
      </Button>
      {children}
      <HiddenFileInput
        ref={input}
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        aria-label={aria["aria-label"]}
        onChange={(e) => {
          take(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
