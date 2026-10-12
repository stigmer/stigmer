# Session event id vectors

This directory pins how a tool use's session event id is derived from the
run and the provider's call id. The runner writes every event a turn
produces with an id derived from the row it describes, never minted, so a
resumed or retried turn names the same fact the same way and the session log
recognises what it already holds.

## The rule

A tool use's event id is `<runId>.<callId>` when that string matches the
contract's id pattern (`^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$`) with 16
characters to spare for the suffixes other events add (`.r` for the result,
`.ask` for the permission ask), and the call id is neither empty nor `root`
(the root thread's scope segment). Otherwise it is `<runId>.h` followed by the
first 32 hex digits of the SHA-256 of the call id.

Run ids are server-minted (`run_<ulid>`) and hold no `.`, so the first `.` of
an event id ends its run part.

## Readers

- The runner: `backend/services/runner/src/harness/events/ids.ts`, which
  derives the ids it writes; `src/harness/events/__tests__/ids-corpus.test.ts`
  asserts every vector.
- A reader that answers a tool use derives the same id from the call id it
  holds, and loads this file in its own test.
