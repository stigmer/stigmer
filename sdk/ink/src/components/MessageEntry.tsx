// One message of the terminal conversation: a person's message, the agent's
// message (its markdown drawn as Ink elements, components/Markdown.tsx), a
// platform note, or the agent's thinking, from the session's fold. Thinking is
// one dim line, "✻ Thinking" while it streams and "✻ Thought" once settled,
// with the start of its text; expanded, its whole text. Thinking a model kept
// to itself (settled with no text) draws nothing, as in the browser.
import React from "react";
import { Box, Text } from "ink";
import type { ThreadMessage } from "@stigmer/react-core";
import { Markdown } from "./Markdown.js";
import { useRoles } from "../theme.js";

/** Props for {@link MessageEntry}. */
export interface MessageEntryProps {
  /** The message to render. */
  readonly message: ThreadMessage;
  /** Whether thinking shows its whole text rather than its first line (Ctrl+O). */
  readonly expanded?: boolean;
}

/** How much of a thinking's text its one line shows, as the browser's does. */
export const THINKING_PREVIEW_LENGTH = 80;

/**
 * Renders a single message in the terminal conversation thread.
 *
 * - `user` — plain text under a "You" label
 * - `message` — the agent's markdown under an "Agent" label, with a
 *   "Thinking..." line while it is still empty and live
 * - `note` — dimmed text
 * - `thinking` — one dim line, its whole text when `expanded`
 */
export function MessageEntry({ message, expanded = false }: MessageEntryProps) {
  switch (message.kind) {
    case "user":
      return <HumanMessage content={message.text} />;
    case "message":
      return <AiMessage content={message.text} isStreaming={message.live} />;
    case "note":
      return <SystemMessage content={message.text} />;
    case "thinking":
      return <ThinkingLine text={message.text} live={message.live} expanded={expanded} />;
  }
}

/** The start of a thinking's text, on one line, cut at the preview length. */
export function thinkingPreview(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > THINKING_PREVIEW_LENGTH ? `${flat.slice(0, THINKING_PREVIEW_LENGTH).trimEnd()}…` : flat;
}

function HumanMessage({ content }: { content: string }) {
  const role = useRoles();
  return (
    <Box flexDirection="column" paddingLeft={1}>
      <Text bold {...role.accent}>
        You
      </Text>
      <Text>{content}</Text>
    </Box>
  );
}

/** The label above the agent's message; the thread draws it above a reply's first block. */
export function AgentLabel() {
  const role = useRoles();
  return (
    <Text bold {...role.success}>
      Agent
    </Text>
  );
}

function AiMessage({ content, isStreaming }: { content: string; isStreaming: boolean }) {
  const hasContent = content.trim() !== "";
  return (
    <Box flexDirection="column" paddingLeft={1}>
      <AgentLabel />
      {hasContent ? <Markdown text={content} /> : null}
      {isStreaming && !hasContent && <Text dimColor>Thinking...</Text>}
    </Box>
  );
}

function ThinkingLine({ text, live, expanded }: { text: string; live: boolean; expanded: boolean }) {
  const role = useRoles();
  const preview = thinkingPreview(text);
  if (!live && preview === "") return null;
  const label = live ? "✻ Thinking" : "✻ Thought";
  if (expanded && preview !== "") {
    return (
      <Box flexDirection="column" paddingLeft={1}>
        <Text {...role.muted}>{label}</Text>
        <Box paddingLeft={2}>
          <Text {...role.muted} italic>
            {text.trim()}
          </Text>
        </Box>
      </Box>
    );
  }
  return (
    <Box paddingLeft={1}>
      <Text {...role.muted} wrap="truncate-end">
        {label}
        {preview !== "" && <Text italic>{` ${preview}`}</Text>}
      </Text>
    </Box>
  );
}

function SystemMessage({ content }: { content: string }) {
  return (
    <Box paddingLeft={1}>
      <Text dimColor italic>
        {content}
      </Text>
    </Box>
  );
}
