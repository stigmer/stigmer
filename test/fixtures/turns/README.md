# Turn fixtures

These files are the **single source of truth** for how a client reads one turn's
outcome from a session's stream: when the wait for a turn returns, how the turn
stands, and what its answer is. Every language's send-and-wait reads them:
TypeScript's `sendAndWait` / `waitForTurn` over the shared fold
(`backend/libs/ts/session-log/src/fold.ts`), and the turn readers the Go, Python
and Java SDKs carry instead of the whole fold. A rule that drifts in one
language fails that language's suite, naming the case.

## The rules they hold

Taken from the fold, which is the reference:

- **Ended.** The turn's newest `stigmer.run.status` phase is `completed`,
  `failed`, `cancelled` or `terminated`. Another run's status never counts.
- **Waiting.** The session is idle with stop reason `requires_action`, and the
  idle names one of the turn's tool uses that asks for permission
  (`evaluated_permission` `ask`) and has neither a confirmation nor a result.
- **Answer.** The text of the turn's last stored message on its primary thread
  (an event with no `thread_id`): a sub-agent's message and a live preview are
  never the answer. Its text blocks are joined with nothing between them.
- **Once.** An event already read (by id) is skipped, so a stream resumed from
  an older place reads each event once.
- **Return.** The wait returns at the first frame after which the turn has
  ended or waits; `lastSeq` is the newest `seq` read by then.

## Contract

One case per file:

```json
{
  "description": "What the case shows.",
  "runId": "run_1",
  "frames": [{ "event": { "seq": "1", "sessionId": "ses_1", "runId": "run_1", "agentMessage": { "id": "m1", "content": [{ "type": "text", "text": "Hi" }] } } }],
  "expect": {
    "decided": true,
    "phase": "completed",
    "answer": "Hi",
    "stopCause": "end_turn",
    "error": "",
    "asks": [{ "id": "t4", "name": "Bash" }],
    "lastSeq": "5"
  }
}
```

Each frame is a `StreamSessionEventsResponse` in protobuf JSON
(`apis/ai/stigmer/agentic/session/v1/io.proto`), which every language parses
natively. A reader feeds the frames in order and stops at its first decision;
`expect` is the outcome then, or `{ "decided": false }` when the frames never
end the turn or make it wait.

## Consumers

- TypeScript: `sdk/typescript/src/__tests__/session-events.test.ts`
- Go: `sdk/go/turn_test.go`
- Python: `sdk/python/tests/test_turns.py`
- Java: `sdk/java/src/test/java/ai/stigmer/sdk/TurnWaiterTest.java`
