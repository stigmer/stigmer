import { isValidElement, type ComponentProps, type JSX, type ReactNode } from "react";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@stigmer/theme";
import { highlightToReact } from "./code-highlight.js";
import { MermaidDiagram } from "./MermaidDiagram.js";

const LANGUAGE_CLASS_PREFIX = "language-";
const MERMAID_LANGUAGE_CLASS = "language-mermaid";

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
 * Matches content whose ENTIRE body is a single fenced code block with an
 * EMPTY info string (no language tag). Only meaningful for surfaces that know
 * the body is markdown by contract (a Plan-mode plan) — see
 * {@link unwrapEnclosingMarkdownFence}'s `allowBareFence`.
 */
const ENCLOSING_BARE_FENCE_RE = /^(`{3,})[ \t]*\r?\n([\s\S]*?)\r?\n\1[ \t]*$/;

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
 * `allowBareFence` extends the unwrap to a whole-body fence with NO language
 * tag. For an ordinary chat message a bare fence is ambiguous (it may be a
 * legitimate single code block), so the default stays strict. A Plan-mode plan
 * is different by contract: the turn's output IS a markdown document, so a
 * reply that is one giant untagged fence is a wrapped plan, not code. Only
 * plan-document surfaces pass `true`. A fence tagged with any other language
 * (```python …) is never unwrapped in either mode.
 *
 * Render-time only: callers pass it the text right before handing it to the
 * markdown renderer, so the transcript and the raw artifact stay faithful to
 * what the agent produced — a single source of truth for the unwrap, with no
 * duplicated logic in the runner. While streaming, the closing fence has not
 * arrived yet, so this no-ops and the live text renders as typed; it unwraps
 * once the block closes.
 */
export function unwrapEnclosingMarkdownFence(
  content: string,
  allowBareFence = false,
): string {
  const trimmed = content.trim();
  const tagged = ENCLOSING_MARKDOWN_FENCE_RE.exec(trimmed);
  if (tagged) return tagged[2];
  if (allowBareFence) {
    const bare = ENCLOSING_BARE_FENCE_RE.exec(trimmed);
    if (bare) return bare[2];
  }
  return content;
}

/**
 * Matches a document that OPENS with an `# H1` heading (optionally preceded by
 * blank lines only). Group 1 is the heading text; the match spans through the
 * heading's trailing newline(s) so `body` starts at the first content line.
 */
const LEADING_H1_RE = /^#[ \t]+(.+?)[ \t]*(?:\r?\n+|$)/;

/**
 * Splits a markdown document into its leading `# H1` title and the remaining
 * body, for surfaces that render the title in their own chrome (the plan
 * document header) instead of inside the prose flow.
 *
 * Only a heading at the very start of the document counts as the title — an
 * `# H1` further down is document content and stays in the body. When there is
 * no leading H1, `title` is `null` and `body` is the input unchanged.
 *
 * Render-time only, like {@link unwrapEnclosingMarkdownFence}: the stored
 * message/artifact keeps its heading; only the presentation moves it.
 */
export function extractLeadingH1(markdown: string): {
  readonly title: string | null;
  readonly body: string;
} {
  const trimmed = markdown.trim();
  const match = LEADING_H1_RE.exec(trimmed);
  if (!match) return { title: null, body: markdown };
  return { title: match[1], body: trimmed.slice(match[0].length) };
}

/**
 * Returns the mermaid source when a `pre` element's children are a single
 * fenced code block explicitly tagged `mermaid`, or `null` otherwise.
 *
 * Both renderers (Streamdown for chat, react-markdown for artifacts/skills)
 * hand `pre` exactly one `<code>` child whose `className` carries the fence's
 * info string as `language-*` and whose children are the raw source text.
 * Anything that deviates from that shape — a different language, a missing
 * tag, non-string children — is not a mermaid fence and keeps the ordinary
 * code-block rendering. Only the explicit `mermaid` tag qualifies:
 * inspecting fence bodies to guess diagram intent is the kind of fuzzy
 * heuristic this codebase avoids.
 */
function extractMermaidSource(children: ReactNode): string | null {
  if (!isValidElement(children)) return null;
  const { className, children: code } = children.props as {
    className?: unknown;
    children?: unknown;
  };
  if (typeof className !== "string") return null;
  if (!className.split(/\s+/).includes(MERMAID_LANGUAGE_CLASS)) return null;
  return typeof code === "string" ? code : null;
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
      <p className="stg:text-sm stg:text-foreground stg:mb-3 stg:last:mb-0 stg:leading-relaxed stg:break-words" {...props}>
        {children}
      </p>
    );
  },

  a({ children, href, ...props }: MdProps<"a">) {
    return (
      <a
        href={href}
        className="stg:text-primary stg:underline stg:underline-offset-2 stg:hover:text-primary-muted stg:break-words"
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
      <h1 className="stg:text-lg stg:font-semibold stg:text-foreground stg:mt-5 stg:mb-2 stg:first:mt-0 stg:break-words" {...props}>
        {children}
      </h1>
    );
  },

  h2({ children, ...props }: MdProps<"h2">) {
    return (
      <h2 className="stg:text-base stg:font-semibold stg:text-foreground stg:mt-5 stg:mb-2 stg:first:mt-0 stg:break-words" {...props}>
        {children}
      </h2>
    );
  },

  h3({ children, ...props }: MdProps<"h3">) {
    return (
      <h3 className="stg:text-sm stg:font-semibold stg:text-foreground stg:mt-4 stg:mb-1.5 stg:first:mt-0 stg:break-words" {...props}>
        {children}
      </h3>
    );
  },

  h4({ children, ...props }: MdProps<"h4">) {
    return (
      <h4 className="stg:text-sm stg:font-medium stg:text-foreground stg:mt-3 stg:mb-1 stg:first:mt-0 stg:break-words" {...props}>
        {children}
      </h4>
    );
  },

  ul({ children, ...props }: MdProps<"ul">) {
    return (
      <ul className="stg:list-disc stg:pl-5 stg:mb-3 stg:last:mb-0 stg:space-y-1 stg:text-sm stg:text-foreground" {...props}>
        {children}
      </ul>
    );
  },

  ol({ children, ...props }: MdProps<"ol">) {
    return (
      <ol className="stg:list-decimal stg:pl-5 stg:mb-3 stg:last:mb-0 stg:space-y-1 stg:text-sm stg:text-foreground" {...props}>
        {children}
      </ol>
    );
  },

  li({ children, ...props }: MdProps<"li">) {
    return (
      <li className="stg:leading-relaxed stg:break-words" {...props}>
        {children}
      </li>
    );
  },

  pre({ children, ...props }: MdProps<"pre">) {
    // A ```mermaid fence renders as a diagram, not a code block. The check
    // lives here (not in the `code` override) because the diagram must
    // replace the <pre> wrapper too — a block-level diagram container inside
    // <pre> is invalid HTML and would inherit code-block chrome.
    const mermaidSource = extractMermaidSource(children);
    if (mermaidSource !== null) {
      return <MermaidDiagram chart={mermaidSource} />;
    }

    return (
      <pre
        className="stg:mb-3 stg:last:mb-0 stg:overflow-x-auto stg:rounded-md stg:bg-muted stg:p-3"
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
            "hljs stg:font-mono stg:text-xs stg:text-foreground",
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
        className="stg:font-mono stg:text-xs stg:bg-muted stg:px-1 stg:py-0.5 stg:rounded stg:text-foreground stg:break-words"
        {...props}
      >
        {children}
      </code>
    );
  },

  blockquote({ children, ...props }: MdProps<"blockquote">) {
    return (
      <blockquote
        className="stg:border-l-2 stg:border-border stg:pl-4 stg:mb-3 stg:last:mb-0 stg:text-muted-foreground stg:italic"
        {...props}
      >
        {children}
      </blockquote>
    );
  },

  table({ children, ...props }: MdProps<"table">) {
    return (
      <div className="stg:mb-3 stg:last:mb-0 stg:overflow-x-auto">
        <table className="stg:w-full stg:border-collapse stg:text-sm" {...props}>
          {children}
        </table>
      </div>
    );
  },

  th({ children, ...props }: MdProps<"th">) {
    return (
      <th
        className="stg:border stg:border-border stg:px-3 stg:py-1.5 stg:text-left stg:font-medium stg:text-foreground stg:bg-muted-subtle"
        {...props}
      >
        {children}
      </th>
    );
  },

  td({ children, ...props }: MdProps<"td">) {
    return (
      <td className="stg:border stg:border-border stg:px-3 stg:py-1.5 stg:text-foreground" {...props}>
        {children}
      </td>
    );
  },

  hr(props: MdProps<"hr">) {
    return <hr className="stg:my-4 stg:border-border" {...props} />;
  },

  strong({ children, ...props }: MdProps<"strong">) {
    return (
      <strong className="stg:font-semibold stg:text-foreground" {...props}>
        {children}
      </strong>
    );
  },

  em({ children, ...props }: MdProps<"em">) {
    return (
      <em className="stg:italic" {...props}>
        {children}
      </em>
    );
  },
};

/**
 * Document-grade typography for a Plan-mode plan: one step up the heading
 * scale from the chat-tuned {@link MARKDOWN_COMPONENTS}, wider section
 * spacing, and a hairline under `##` section headings for scannability. The
 * plan is a reviewable document, not a chat bubble — its headings must carry
 * the structure at a glance.
 *
 * Everything except the headings is inherited from `MARKDOWN_COMPONENTS`, so
 * body text, code, tables, and links render identically across chat and plan
 * surfaces. Used by `PlanDocumentMessage` (thread) — the same treatment any
 * plan-document surface should share.
 */
export const PLAN_DOCUMENT_MARKDOWN_COMPONENTS: Components = {
  ...MARKDOWN_COMPONENTS,

  h1({ children, ...props }: MdProps<"h1">) {
    return (
      <h1 className="stg:text-lg stg:font-semibold stg:text-foreground stg:mt-6 stg:mb-3 stg:first:mt-0 stg:break-words" {...props}>
        {children}
      </h1>
    );
  },

  h2({ children, ...props }: MdProps<"h2">) {
    return (
      <h2
        className="stg:text-base stg:font-semibold stg:text-foreground stg:mt-6 stg:mb-2.5 stg:pb-1 stg:border-b stg:border-border-muted stg:first:mt-0 stg:break-words"
        {...props}
      >
        {children}
      </h2>
    );
  },

  h3({ children, ...props }: MdProps<"h3">) {
    return (
      <h3 className="stg:text-sm stg:font-semibold stg:text-foreground stg:mt-5 stg:mb-2 stg:first:mt-0 stg:break-words" {...props}>
        {children}
      </h3>
    );
  },

  h4({ children, ...props }: MdProps<"h4">) {
    return (
      <h4 className="stg:text-sm stg:font-medium stg:text-foreground stg:mt-4 stg:mb-1.5 stg:first:mt-0 stg:break-words" {...props}>
        {children}
      </h4>
    );
  },
};
