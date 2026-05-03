# React SDK: Streaming Markdown via Streamdown (T07)

**Date**: May 3, 2026

## Summary

Replaced `react-markdown` with Vercel's [Streamdown](https://github.com/vercel/streamdown) library in the `AiMessage` component to eliminate full-document re-parsing on every stream tick. Streamdown provides block-level memoization (only the actively growing block re-renders), incomplete-syntax healing (`remend`), and a built-in streaming caret — directly addressing the last major source of wasted work during token streaming.

## Problem Statement

During streaming, `AiMessage` passed the full (growing) content string to `react-markdown` on every React commit. The unified/remark/rehype pipeline re-parsed the **entire** document from scratch each time — all completed paragraphs, code blocks, and tables were parsed, diffed, and reconciled even though only the tail was changing.

### Pain Points

- **O(n) re-parsing per frame**: For a 6,000-character response arriving in 300 chunks, `react-markdown` parsed roughly `20 + 40 + 60 + ... + 6000` characters total — orders of magnitude more work than rendering 6,000 characters once.
- **Incomplete Markdown jank**: Unterminated bold (`**This is bol`), unclosed code fences, and partial links rendered as literal characters during streaming.
- **Manual caret management**: A separate `<span>` with `animate-pulse` was appended after the markdown output, adding DOM complexity.

## Solution

Adopted **Streamdown v2** as a streaming-specific markdown renderer for `AiMessage`. Static markdown consumers (`SkillDetailView`, `ArtifactContentRenderer`) continue using `react-markdown`.

### What Streamdown Provides

- **Block-level memoization**: Splits markdown into blocks (paragraphs, code fences, tables). Completed blocks are frozen and skip re-renders. Only the actively growing tail block re-renders on each React commit.
- **`remend` preprocessor**: Gracefully handles incomplete syntax during streaming — unterminated bold, unclosed code fences, and partial links render correctly instead of showing literal characters.
- **`isAnimating` prop**: When `false` (message complete), the streaming pipeline is bypassed entirely — zero overhead for completed messages. When `true`, streaming optimizations are active.
- **Built-in caret**: `caret="block"` renders `▋` (U+258B) as a CSS `::after` pseudo-element on the last block. No extra DOM element, no animation spans.
- **`components` prop**: 100% compatible with `react-markdown`'s component override API — the existing `MARKDOWN_COMPONENTS` work without changes or type assertions.
- **GFM built-in**: No need for separate `remarkPlugins={[remarkGfm]}`.

## Implementation Details

### Files Changed

| File | Change |
|------|--------|
| `sdk/react/package.json` | Added `streamdown ^2.5.0` |
| `sdk/react/src/styles.css` | Added `@source "../node_modules/streamdown/dist/*.js"` for Tailwind class detection |
| `sdk/react/src/execution/MessageEntry.tsx` | Replaced `<Markdown>` with `<Streamdown>` in `AiMessage`; removed manual caret `<span>` |
| `sdk/react/src/execution/__tests__/message-entry.test.tsx` | NEW — 17 tests covering all message types and Streamdown integration |

### AiMessage Before

```tsx
<Markdown remarkPlugins={REMARK_PLUGINS} components={MARKDOWN_COMPONENTS}>
  {content}
</Markdown>
{isStreaming && <span className="... animate-pulse" aria-hidden="true" />}
```

### AiMessage After

```tsx
<Streamdown components={MARKDOWN_COMPONENTS} isAnimating={isStreaming} caret="block">
  {content}
</Streamdown>
```

### Dependency Decision

- **Added**: `streamdown` (core package only, no plugins)
- **Kept**: `react-markdown` (still used by `SkillDetailView`, `ArtifactContentRenderer`)
- **Kept**: `remark-gfm` (still used by non-Streamdown consumers)
- **Not added**: `@streamdown/code`, `@streamdown/math`, `@streamdown/mermaid` (out of scope)

## Benefits

- **Eliminated O(n) full-document re-parsing**: Only the active tail block is re-parsed per frame. Completed blocks are frozen.
- **Clean incomplete-syntax rendering**: No more literal asterisks or broken code fences mid-stream.
- **Simpler caret implementation**: Built-in CSS caret replaces manual DOM element.
- **Zero public API changes**: `MessageEntry` props unchanged. `MARKDOWN_COMPONENTS` work without modification.
- **Type-safe integration**: `react-markdown`'s `Components` type is structurally compatible with Streamdown — no type assertions needed.

## Impact

- **SDK consumers**: AI message rendering during streaming is significantly more efficient. Completed blocks within a long response are frozen and never re-rendered.
- **End users**: Smoother streaming experience — no visual jank from incomplete markdown syntax.
- **Maintainers**: `AiMessage` is simpler (fewer lines, no manual caret logic).

## Related Work

- **T04** (ConversationStore with Structural Sharing): Ensures unchanged messages keep the same reference, so `React.memo` on `MessageEntry` prevents re-renders of completed messages entirely.
- **T05** (Row-Level Memoization): `MessageEntry` wrapped in `React.memo` — only the actively streaming message re-renders.
- **T06** (Stream Controller FSM): rAF coalescing ensures React commits at most once per display frame. Combined with Streamdown's block-level memoization, this means only the tail block of the tail message re-renders per frame.
- **T12** (Animation & Polish — future): Streamdown's `animated` prop for per-word fade-in effects is available but not enabled in T07.

---

**Status**: Production Ready
**Phase**: 5 of 10 in the React SDK Streaming UX project
**Test Suite**: 364/364 pass (347 existing + 17 new)
