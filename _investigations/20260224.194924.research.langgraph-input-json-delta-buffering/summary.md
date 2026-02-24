# LangGraph input_json_delta Buffering - Research Summary

**Date:** February 24, 2026
**Source:** ChatGPT Deep Research
**Verdict:** Root cause identified - Anthropic API server-side buffering, not LangGraph

---

## Key Finding

The 30-second buffering of `input_json_delta` events is caused by **Anthropic's default tool-argument streaming behavior**, which buffers and JSON-validates tool parameters before streaming them. This is documented by Anthropic as the default behavior -- fine-grained tool streaming exists specifically to bypass it.

## Evidence

| Signal | Explanation |
| --- | --- |
| Thinking blocks stream in real-time | Thinking tokens are not subject to JSON validation buffering |
| `tool_use` header arrives immediately | Block start (name/ID) is announced before arguments |
| `input_json_delta` delayed 30s then bursts | Arguments were buffered upstream for JSON validation |
| Only 9 events in 30s gap | LangGraph had nothing to emit -- Anthropic wasn't sending deltas |
| LangChain.js issue reports identical pattern | Same "gap then burst" with Anthropic tool calls |
| Anthropic TypeScript SDK issue reports same | Long delay when using streaming + tools |

## Fix: Enable Fine-Grained Tool Streaming

Anthropic's documented fix: set `eager_input_streaming: true` on tool definitions. This streams tool parameters **without buffering or JSON validation**, reducing latency.

### Implementation Routes

| Route | Mechanism | Notes |
| --- | --- | --- |
| A: Tool definition | Add `eager_input_streaming: true` to tool schema | Most direct; requires langchain-anthropic to pass it through |
| B: Beta flag | `ChatAnthropic(betas=["fine-grained-tool-streaming-2025-05-14"])` | Documented in LangChain PR; may still be needed |

### Tradeoff

Fine-grained streaming may deliver **invalid or partial JSON** mid-stream. The renderer must treat streamed args as a character stream for display and only parse as JSON after completion signal.

## What Will NOT Fix This

- Upgrading LangGraph (1.0.8 → 1.0.9+): no tool-streaming latency fixes in release notes
- Switching to `stream_mode="messages"`: won't fix upstream buffering, but is recommended as streaming interface once fix is applied
- Adding instrumentation to LangGraph layers: the buffering is above LangGraph

## Recommended Actions (Priority Order)

1. Enable `eager_input_streaming: true` via tool definitions or beta flag
2. Consider upgrading `langchain-anthropic` 1.3.3 → 1.3.4 (released Feb 24, 2026)
3. Optionally switch to `stream_mode=["messages","updates"]` for cleaner streaming interface
4. Harden renderer to handle partial JSON during streaming

---

_Summary generated: February 24, 2026_
_Full report: `04.report.gpt.md`_
