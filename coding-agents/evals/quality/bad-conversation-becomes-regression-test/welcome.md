What a good answer may also say. Never graded: leaving any of it out fails nothing.

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
