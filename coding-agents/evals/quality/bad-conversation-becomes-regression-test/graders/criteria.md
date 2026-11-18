---
type: llm
---

Judge the answer on these points alone. It passes when it makes every Must point and does nothing a FAIL-if line names. Leaving out a Welcome point never fails it, and a correct point not listed here is no fault.

**Must**

- Names the documented way to turn the run into a test case, for example `stigmer runs to-eval-case <run-id>` or **Make a test case** on the run's score row in the console.
- Says the case replays the run: it holds the request the run answered, and each answer an MCP tool gave the run becomes a mock, so the failed post is replayed rather than called for real.
- Says the case's `llm` grader carries a FAIL line naming what went wrong, and the person writes the PASS line themselves, since only they know what a correct reply holds.
- Says to run it on the Agent once the case is in an eval, for example `stigmer eval run --agent <agent> --eval <eval-name>`.

**FAIL if**

- It has them hand-write the whole case from scratch as the only route.
- It invents commands or flags the docs don't name, such as `stigmer eval add-run` or `stigmer runs export`.
- It claims the generated case decides pass/fail on its own.
- It has the case call their real ledger server.

**Welcome**

- `--dir` and `--name` choose the folder and the case's name; in the console, **Download the case folder** or **Add to eval**.
- `history.jsonl` and `case.yaml` hold the conversation before the request when the run continued one, and `mocks/<server>/_tools.json` holds each mocked tool's description and input schema as the run offered them.
- The FAIL line comes from the AI judge's failing reason, else an eval run's failing check, else the comment on a thumbs-down, so leaving a thumbs-down with a comment on the run first makes the FAIL line carry it.
- A local case is pushed with `stigmer push eval <folder> --name <eval-name>`; a case added to an eval is pulled back with `stigmer download eval` before editing the folder.
- A run that has not ended cannot become a case yet.
- The CLI refuses to overwrite an existing case folder, and an eval refuses a case name it already holds.
- Adding a case to an eval shows the conversation to everyone who can read the eval.
- Stigmer never writes into their repository: they review the case, commit it and push the folder again.
- A fix for this kind of failure: marking the posting tool destructive (`destructiveHint: true`) so it asks first, or the `made-nothing-up` rubric of AI grading, which fails a run whose answer claims an action its tool calls do not show.
- `stigmer runs to-eval-case` writes the case into a local `evals/` folder or, with `--eval <eval-name>`, adds it to an eval as a new version.
- The request is in the case's `prompt.md`, the grader in `graders/criteria.md`.
