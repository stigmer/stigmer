"use client";

import type { ReactNode } from "react";

// Monochrome, shape-differentiated file icons. Deliberately NOT colored with
// language brand colors: DD-005 forbids hardcoded colors, and every glyph must
// tint from `currentColor` so it inherits the row's `--stgm-*` token in every
// preset and color mode (like VS Code's "Minimal" icon theme). Recognition
// comes from distinct shapes per broad category, not from color.

/** Broad file categories, chosen so one glyph serves many related extensions. */
export type FileIconCategory =
  | "code"
  | "markup"
  | "style"
  | "data"
  | "markdown"
  | "image"
  | "generic";

/**
 * Extension → category. Kept intentionally coarse: adding a language usually
 * means adding one entry here, not a new glyph. Unknown extensions fall back to
 * the generic document icon.
 */
const EXTENSION_CATEGORY: Readonly<Record<string, FileIconCategory>> = {
  // code
  js: "code", jsx: "code", mjs: "code", cjs: "code",
  ts: "code", tsx: "code",
  py: "code", rb: "code", go: "code", rs: "code",
  java: "code", kt: "code", c: "code", h: "code",
  cpp: "code", cc: "code", hpp: "code", cs: "code",
  php: "code", swift: "code", sh: "code", bash: "code", zsh: "code",
  lua: "code", dart: "code", scala: "code", proto: "code",
  // markup
  html: "markup", htm: "markup", xml: "markup", vue: "markup", svelte: "markup",
  // style
  css: "style", scss: "style", sass: "style", less: "style",
  // data / config
  json: "data", jsonc: "data", yaml: "data", yml: "data",
  toml: "data", ini: "data", env: "data", csv: "data", tsv: "data",
  // markdown
  md: "markdown", mdx: "markdown", markdown: "markdown",
  // image
  png: "image", jpg: "image", jpeg: "image", gif: "image",
  webp: "image", svg: "image", ico: "image", bmp: "image",
};

/** Classify a file name into a {@link FileIconCategory} by its extension. */
export function fileIconCategory(fileName: string): FileIconCategory {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0 || dot === fileName.length - 1) return "generic";
  const ext = fileName.slice(dot + 1).toLowerCase();
  return EXTENSION_CATEGORY[ext] ?? "generic";
}

/**
 * A monochrome icon for a file, chosen by extension category. Tints from
 * `currentColor`; size via the surrounding font/box.
 */
export function FileTypeIcon({ fileName }: { readonly fileName: string }): ReactNode {
  const category = fileIconCategory(fileName);
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
      aria-hidden="true"
    >
      {/* Every category shares a document outline for a consistent silhouette. */}
      <path d="M9.5 1.5H4.5C3.95 1.5 3.5 1.95 3.5 2.5V13.5C3.5 14.05 3.95 14.5 4.5 14.5H11.5C12.05 14.5 12.5 14.05 12.5 13.5V4.5L9.5 1.5Z" />
      <path d="M9.3 1.7V4.5H12.3" />
      {CATEGORY_GLYPH[category]}
    </svg>
  );
}

/** The inner glyph that distinguishes each category, drawn in the doc body. */
const CATEGORY_GLYPH: Readonly<Record<FileIconCategory, ReactNode>> = {
  code: (
    <>
      <path d="M7 8.5L5.75 9.75L7 11" />
      <path d="M9 8.5L10.25 9.75L9 11" />
    </>
  ),
  markup: (
    <>
      <path d="M6.5 8.5L5.5 9.9L6.5 11.3" />
      <path d="M9.5 8.5L10.5 9.9L9.5 11.3" />
    </>
  ),
  style: <path d="M5.5 9.3H10.5M5.5 11.1H8.5" />,
  data: (
    <>
      <path d="M7 8.4C6.2 8.4 6.2 9.3 6.2 9.9C6.2 10.5 6.2 11.4 5.4 11.4" />
      <path d="M9 8.4C9.8 8.4 9.8 9.3 9.8 9.9C9.8 10.5 9.8 11.4 10.6 11.4" />
    </>
  ),
  markdown: <path d="M5.4 11.3V8.6L6.9 10.1L8.4 8.6V11.3M10.4 8.7V11.1M9.5 10.2L10.4 11.2L11.3 10.2" />,
  image: (
    <>
      <circle cx="6.4" cy="9" r="0.7" />
      <path d="M5.2 11.4L7.3 9.9L10.6 11.6" />
    </>
  ),
  generic: <path d="M5.5 9.3H10.5M5.5 11.1H10.5" />,
};

/** A folder icon; `open` swaps to the opened-folder silhouette. */
export function FolderTypeIcon({ open = false }: { readonly open?: boolean }): ReactNode {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
      aria-hidden="true"
    >
      {open ? (
        <path d="M1.8 5.5V12A1 1 0 002.8 13H12.6L14.5 7.5H4.2L2.8 11" />
      ) : (
        <path d="M1.8 4.5A1 1 0 012.8 3.5H6L7.3 5H13.2A1 1 0 0114.2 6V12A1 1 0 0113.2 13H2.8A1 1 0 011.8 12V4.5Z" />
      )}
    </svg>
  );
}
