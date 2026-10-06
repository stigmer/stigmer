# Recorded Response Fixtures

This directory contains recorded HTTP request/response pairs used by the
`ReplayFetchInterceptor` (`src/__test-utils__/replay-fetch.ts`) for
deterministic offline testing of LLM-dependent code paths.

## Directory Structure

```
recorded-responses/
  agent-toolcall-contract.json     # ToolCall proto field contract
  agent-toolcall-error.json        # ToolCall failed status
```

## Recording New Fixtures

Run the test that installs the interceptor with the `RECORD_FIXTURES`
environment variable:

```bash
RECORD_FIXTURES=1 npx vitest run <test file>
```

This wraps `globalThis.fetch`, forwards LLM API requests to real endpoints,
captures the request/response pairs, and writes them to JSON files here.

**Auth tokens are automatically redacted** in recorded fixtures.

When prompts, system instructions, or tool schemas change, re-record the
affected fixtures the same way.

## Fixture Format

Each JSON file contains:

```json
{
  "name": "fixture-name",
  "recordedAt": "2026-05-22T...",
  "entries": [
    {
      "index": 0,
      "timestamp": "...",
      "request": {
        "method": "POST",
        "url": "https://proxy/v1/proxy/llm/anthropic/v1/messages",
        "headers": { "authorization": "[REDACTED]" },
        "body": { "model": "...", "messages": [...] }
      },
      "response": {
        "status": 200,
        "statusText": "OK",
        "headers": {},
        "body": { "content": [...], "usage": {...} }
      },
      "durationMs": 1234
    }
  ]
}
```

Entries are ordered sequentially and replayed in order during tests.
