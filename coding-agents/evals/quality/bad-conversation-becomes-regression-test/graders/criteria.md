---
type: llm
---

PASS if the answer gives the documented way to turn a run into a test case:
- from the CLI, `stigmer runs to-eval-case <run-id>` writes the case into a local folder (`--dir`, `--name`), or `--eval <eval-name>` adds it to an eval as a new version; in the console, **Make a test case** on the run's score row (download the folder or **Add to eval**);
- what the case holds: `prompt.md` with the request the run answered; `history.jsonl` and `case.yaml` when the run continued a conversation; `mocks/<server>/<tool>.md` with each answer an MCP tool gave the run (so the failed post is replayed, not called for real) and `_tools.json` with the tool's description and schema; `graders/criteria.md`, an `llm` grader whose FAIL line names what went wrong, taken from the AI judge's failing reason, an eval run's failing check, or the comment on a thumbs-down;
- the person writes the PASS line themselves, since only they know what a correct reply holds;
- then they run it: push or download the eval's new version and `stigmer eval run --agent <agent> --eval <eval-name>`.
Welcome but optional: leaving a thumbs-down with a comment on the run first so the FAIL line carries it; a run that has not ended cannot become a case; the CLI refuses to overwrite an existing case folder; adding a case to an eval shows the conversation to everyone who can read the eval; Stigmer never writes into their repository; a fix such as `destructiveHint` or the `made-nothing-up` rubric for this kind of failure.

FAIL if the answer has them hand-write the whole case from scratch as the only route; invents commands or flags the docs don't name (such as `stigmer eval add-run` or `stigmer runs export`); claims the generated case decides pass/fail on its own; or has the case call their real ledger server.
