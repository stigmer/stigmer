// Markdown drawn as Ink elements: each block of a reply (markdown.ts) as
// boxes and text in the roles' weights only (bold, italic, dim, underline),
// never a hue, so a reply reads the same on a light and a dark terminal. Ink
// wraps the text at the frame's width, so what is being written follows a
// resize with nothing pre-wrapped.
//
// - Headings are bold (the first level underlined too), without their `#`.
// - Inline code is bold, without its backticks.
// - A code block sits behind a dim gutter, its lines as written.
// - A table is laid out by Ink: each column as wide as its widest cell, a
//   cell wrapping inside its column when the frame is narrower.
// - A link reads as its text, underlined, with its address dim beside it
//   when the two differ.
//
// `renderMarkdown` draws the same component to a string, for a host that
// prints outside Ink, so the two cannot drift.
//
// Proven by __tests__/markdown.test.ts.

import React from "react";
import { Box, Text, renderToString } from "ink";
import type { Token, Tokens } from "marked";
import { markdownBlocks } from "../markdown.js";

/** Props for {@link Markdown}. */
export interface MarkdownProps {
  /** The markdown text. */
  readonly text: string;
}

/** Props for {@link MarkdownBlock}. */
export interface MarkdownBlockProps {
  /** One top-level block, as `markdownBlocks` returns it. */
  readonly token: Token;
}

/** A markdown text as Ink elements, its blocks a blank line apart (module header). */
export function Markdown({ text }: MarkdownProps) {
  const blocks = markdownBlocks(text);
  return (
    <Box flexDirection="column" gap={1}>
      {blocks.map((token, index) => (
        <MarkdownBlock key={index} token={token} />
      ))}
    </Box>
  );
}

/** One block of markdown as Ink elements (module header). */
export function MarkdownBlock({ token }: MarkdownBlockProps) {
  return <>{block(token)}</>;
}

/**
 * Renders markdown to a string for a terminal, drawn by the same component the
 * session view uses: bold, italic, dim and underline, no colour.
 *
 * @param content - Raw markdown string.
 * @param width - Columns to wrap at. Defaults to `process.stdout.columns`, or 80.
 * @returns The styled text, ready to write to a terminal.
 *
 * @example
 * ```ts
 * import { renderMarkdown } from "@stigmer/ink-ui";
 *
 * process.stdout.write(`${renderMarkdown("**Hello** from the agent!")}\n`);
 * ```
 */
export function renderMarkdown(content: string, width?: number): string {
  if (content.trim() === "") return "";
  const columns = width ?? (process.stdout.columns || 80);
  return renderToString(<Markdown text={content} />, { columns }).trimEnd();
}

function block(token: Token): React.ReactNode {
  switch (token.type) {
    case "heading": {
      const heading = token as Tokens.Heading;
      return (
        <Text bold underline={heading.depth === 1}>
          {inline(heading.tokens)}
        </Text>
      );
    }
    case "paragraph":
      return <Text>{inline((token as Tokens.Paragraph).tokens)}</Text>;
    case "text": {
      const text = token as Tokens.Text;
      return <Text>{text.tokens ? inline(text.tokens) : text.text}</Text>;
    }
    case "code":
      return (
        <Box borderStyle="single" borderTop={false} borderRight={false} borderBottom={false} borderDimColor paddingLeft={1}>
          <Text>{(token as Tokens.Code).text}</Text>
        </Box>
      );
    case "blockquote":
      return (
        <Box borderStyle="bold" borderTop={false} borderRight={false} borderBottom={false} borderDimColor paddingLeft={1} flexDirection="column" gap={1}>
          {(token as Tokens.Blockquote).tokens.map((child, index) => (
            <Text key={index} dimColor italic>
              {child.type === "paragraph" ? inline((child as Tokens.Paragraph).tokens) : child.raw.trim()}
            </Text>
          ))}
        </Box>
      );
    case "list":
      return <List list={token as Tokens.List} />;
    case "table":
      return <Table table={token as Tokens.Table} />;
    case "hr":
      return <Box borderStyle="single" borderTop borderRight={false} borderBottom={false} borderLeft={false} borderDimColor flexGrow={1} />;
    default:
      // html and anything the lexer names that has no drawing: its text as written.
      return <Text>{token.raw.trimEnd()}</Text>;
  }
}

function List({ list }: { list: Tokens.List }) {
  const start = typeof list.start === "number" ? list.start : 1;
  // A task item's box stands in for its bullet.
  const markers = list.items.map((item, index) => {
    if (item.task) return `[${item.checked ? "x" : " "}]`;
    return list.ordered ? `${start + index}.` : "•";
  });
  const width = Math.max(...markers.map((marker) => marker.length));
  return (
    <Box flexDirection="column" gap={list.loose ? 1 : 0}>
      {list.items.map((item, index) => (
        <Box key={index} flexDirection="row">
          <Box width={width + 1} flexShrink={0}>
            <Text>{markers[index]}</Text>
          </Box>
          <Box flexDirection="column" flexGrow={1} flexShrink={1} gap={list.loose ? 1 : 0}>
            {item.tokens
              .filter((child) => child.type !== "space" && child.type !== "checkbox")
              .map((child, childIndex) => (
                <React.Fragment key={childIndex}>{block(child)}</React.Fragment>
              ))}
          </Box>
        </Box>
      ))}
    </Box>
  );
}

function Table({ table }: { table: Tokens.Table }) {
  const widths = table.header.map((cell, column) =>
    Math.max(textWidth(plain(cell.tokens)), ...table.rows.map((row) => textWidth(plain(row[column]?.tokens ?? [])))),
  );
  const row = (cells: readonly Tokens.TableCell[], header: boolean, key: string) => (
    <Box key={key} flexDirection="row" gap={2}>
      {widths.map((width, column) => (
        <Box key={column} width={width} flexShrink={1} justifyContent={justify(table.align[column])}>
          <Text bold={header}>{inline(cells[column]?.tokens ?? [])}</Text>
        </Box>
      ))}
    </Box>
  );
  return (
    <Box flexDirection="column">
      {row(table.header, true, "header")}
      <Box flexDirection="row" gap={2}>
        {widths.map((width, column) => (
          // A rule as wide as its column, however far the column shrinks.
          <Box key={column} width={width} flexShrink={1} borderStyle="single" borderTop borderRight={false} borderBottom={false} borderLeft={false} borderDimColor />
        ))}
      </Box>
      {table.rows.map((cells, index) => row(cells, false, `row-${index}`))}
    </Box>
  );
}

function justify(align: Tokens.Table["align"][number]): "flex-start" | "center" | "flex-end" {
  if (align === "right") return "flex-end";
  if (align === "center") return "center";
  return "flex-start";
}

function inline(tokens: readonly Token[]): React.ReactNode {
  return tokens.map((token, index) => <React.Fragment key={index}>{span(token)}</React.Fragment>);
}

function span(token: Token): React.ReactNode {
  switch (token.type) {
    case "strong":
      return <Text bold>{inline((token as Tokens.Strong).tokens)}</Text>;
    case "em":
      return <Text italic>{inline((token as Tokens.Em).tokens)}</Text>;
    case "del":
      return <Text strikethrough>{inline((token as Tokens.Del).tokens)}</Text>;
    case "codespan":
      return <Text bold>{(token as Tokens.Codespan).text}</Text>;
    case "br":
      return "\n";
    case "link": {
      const link = token as Tokens.Link;
      const label = plain(link.tokens);
      return (
        <>
          <Text underline>{inline(link.tokens)}</Text>
          {link.href !== label && link.href !== `mailto:${label}` && <Text dimColor>{` (${link.href})`}</Text>}
        </>
      );
    }
    case "image": {
      const image = token as Tokens.Image;
      return <Text dimColor>{`[${image.text || "image"}] (${image.href})`}</Text>;
    }
    case "text": {
      const text = token as Tokens.Text;
      return text.tokens ? inline(text.tokens) : text.text;
    }
    case "escape":
      return (token as Tokens.Escape).text;
    default:
      return token.raw;
  }
}

/** A run of inline tokens as plain text, for measuring a table's columns and comparing a link's label. */
function plain(tokens: readonly Token[]): string {
  return tokens
    .map((token) => {
      if ("tokens" in token && Array.isArray(token.tokens)) return plain(token.tokens);
      if (token.type === "codespan" || token.type === "text" || token.type === "escape") return (token as Tokens.Text).text;
      return token.raw;
    })
    .join("");
}

function textWidth(text: string): number {
  return Math.max(0, ...text.split("\n").map((line) => [...line].length));
}
