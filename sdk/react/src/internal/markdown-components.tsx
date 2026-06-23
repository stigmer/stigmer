import type { ComponentProps, JSX } from "react";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@stigmer/theme";
import { highlightToReact } from "./code-highlight";

const LANGUAGE_CLASS_PREFIX = "language-";

type MdProps<T extends keyof JSX.IntrinsicElements> = ComponentProps<T>;

/**
 * Remark plugins applied to all SDK markdown surfaces.
 * Includes GFM (tables, strikethrough, autolinks, task lists).
 */
export const REMARK_PLUGINS = [remarkGfm];

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

/**
 * Strips YAML frontmatter from markdown content.
 *
 * SKILL.md files store metadata (`name`, `description`) in a `---` delimited
 * YAML block at the top. The backend extracts these into separate proto fields,
 * but the raw `skill_md` still contains the block. `react-markdown` does not
 * understand frontmatter and renders it as a plain paragraph — this utility
 * removes it before rendering.
 */
export function stripFrontmatter(content: string): string {
  return content.replace(FRONTMATTER_RE, "");
}

/**
 * Matches content whose ENTIRE body is a single fenced code block tagged
 * `markdown` / `md`. Capture group 1 is the opening backtick run (so the close
 * must use the same run via the `\1` backreference); group 2 is the inner body.
 *
 * Deliberately strict: the info string must be exactly `markdown`/`md` and the
 * fence must span the whole (trimmed) string. A bare ``` ``` ``` fence is NOT
 * matched — without the explicit language tag we cannot tell wrapped markdown
 * from a legitimate single code block, and guessing by inspecting the body is
 * the kind of fuzzy heuristic this codebase avoids.
 */
const ENCLOSING_MARKDOWN_FENCE_RE =
  /^(`{3,})[ \t]*(?:markdown|md)[ \t]*\r?\n([\s\S]*?)\r?\n\1[ \t]*$/i;

/**
 * Unwraps a message the model wrapped entirely in a ```markdown / ```md fence.
 *
 * Some models emit their whole markdown reply inside one fenced block (a
 * Plan-mode plan is the common case). Rendered as-is that becomes a single flat
 * code block instead of rich markdown — headings, lists, and tables collapse to
 * monospace text. This returns the inner markdown in exactly that case and is a
 * no-op for everything else (already-rich markdown, prose, or a reply that is
 * legitimately a single code block).
 *
 * Render-time only: callers pass it the text right before handing it to the
 * markdown renderer, so the transcript and the raw artifact stay faithful to
 * what the agent produced — a single source of truth for the unwrap, with no
 * duplicated logic in the runner. While streaming, the closing fence has not
 * arrived yet, so this no-ops and the live text renders as typed; it unwraps
 * once the block closes.
 */
export function unwrapEnclosingMarkdownFence(content: string): string {
  const match = ENCLOSING_MARKDOWN_FENCE_RE.exec(content.trim());
  return match ? match[2] : content;
}

/**
 * Styled react-markdown component overrides for SDK markdown surfaces.
 *
 * Every element uses `--stgm-*` design tokens via Tailwind semantic classes,
 * ensuring correct rendering in both the Stigmer Console and third-party
 * host applications with custom themes.
 *
 * Used by `MessageEntry` (chat messages) and `SkillDetailView` (SKILL.md).
 */
export const MARKDOWN_COMPONENTS: Components = {
  p({ children, ...props }: MdProps<"p">) {
    return (
      <p className="text-sm text-foreground mb-3 last:mb-0 leading-relaxed" {...props}>
        {children}
      </p>
    );
  },

  a({ children, href, ...props }: MdProps<"a">) {
    return (
      <a
        href={href}
        className="text-primary underline underline-offset-2 hover:text-primary-muted"
        target="_blank"
        rel="noopener noreferrer"
        {...props}
      >
        {children}
      </a>
    );
  },

  h1({ children, ...props }: MdProps<"h1">) {
    return (
      <h1 className="text-lg font-semibold text-foreground mt-5 mb-2 first:mt-0" {...props}>
        {children}
      </h1>
    );
  },

  h2({ children, ...props }: MdProps<"h2">) {
    return (
      <h2 className="text-base font-semibold text-foreground mt-5 mb-2 first:mt-0" {...props}>
        {children}
      </h2>
    );
  },

  h3({ children, ...props }: MdProps<"h3">) {
    return (
      <h3 className="text-sm font-semibold text-foreground mt-4 mb-1.5 first:mt-0" {...props}>
        {children}
      </h3>
    );
  },

  h4({ children, ...props }: MdProps<"h4">) {
    return (
      <h4 className="text-sm font-medium text-foreground mt-3 mb-1 first:mt-0" {...props}>
        {children}
      </h4>
    );
  },

  ul({ children, ...props }: MdProps<"ul">) {
    return (
      <ul className="list-disc pl-5 mb-3 last:mb-0 space-y-1 text-sm text-foreground" {...props}>
        {children}
      </ul>
    );
  },

  ol({ children, ...props }: MdProps<"ol">) {
    return (
      <ol className="list-decimal pl-5 mb-3 last:mb-0 space-y-1 text-sm text-foreground" {...props}>
        {children}
      </ol>
    );
  },

  li({ children, ...props }: MdProps<"li">) {
    return (
      <li className="leading-relaxed" {...props}>
        {children}
      </li>
    );
  },

  pre({ children, ...props }: MdProps<"pre">) {
    return (
      <pre
        className="mb-3 last:mb-0 overflow-x-auto rounded-md bg-muted p-3"
        {...props}
      >
        {children}
      </pre>
    );
  },

  code({ children, className: codeClassName, ...props }: MdProps<"code">) {
    const isBlock =
      typeof codeClassName === "string" &&
      codeClassName.startsWith(LANGUAGE_CLASS_PREFIX);

    if (isBlock) {
      // Tokenize here, in the one component both renderers (Streamdown for
      // chat, react-markdown for artifacts/skills) share, so highlighting is
      // identical everywhere. Highlight only plain-string children — anything
      // else (e.g. a streaming caret node) falls back to flat rendering.
      const language = codeClassName.slice(LANGUAGE_CLASS_PREFIX.length);
      const highlighted =
        typeof children === "string"
          ? highlightToReact(children, language)
          : null;

      return (
        <code
          className={cn(
            "hljs font-mono text-xs text-foreground",
            codeClassName,
          )}
          {...props}
        >
          {highlighted ?? children}
        </code>
      );
    }

    return (
      <code
        className="font-mono text-xs bg-muted px-1 py-0.5 rounded text-foreground"
        {...props}
      >
        {children}
      </code>
    );
  },

  blockquote({ children, ...props }: MdProps<"blockquote">) {
    return (
      <blockquote
        className="border-l-2 border-border pl-4 mb-3 last:mb-0 text-muted-foreground italic"
        {...props}
      >
        {children}
      </blockquote>
    );
  },

  table({ children, ...props }: MdProps<"table">) {
    return (
      <div className="mb-3 last:mb-0 overflow-x-auto">
        <table className="w-full border-collapse text-sm" {...props}>
          {children}
        </table>
      </div>
    );
  },

  th({ children, ...props }: MdProps<"th">) {
    return (
      <th
        className="border border-border px-3 py-1.5 text-left font-medium text-foreground bg-muted-subtle"
        {...props}
      >
        {children}
      </th>
    );
  },

  td({ children, ...props }: MdProps<"td">) {
    return (
      <td className="border border-border px-3 py-1.5 text-foreground" {...props}>
        {children}
      </td>
    );
  },

  hr(props: MdProps<"hr">) {
    return <hr className="my-4 border-border" {...props} />;
  },

  strong({ children, ...props }: MdProps<"strong">) {
    return (
      <strong className="font-semibold text-foreground" {...props}>
        {children}
      </strong>
    );
  },

  em({ children, ...props }: MdProps<"em">) {
    return (
      <em className="italic" {...props}>
        {children}
      </em>
    );
  },
};
