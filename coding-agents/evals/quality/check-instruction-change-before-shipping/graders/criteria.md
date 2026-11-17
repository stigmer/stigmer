---
type: llm
---

PASS if the answer describes the documented eval workflow:
- write test cases in Claude Code's plugin-eval format, an `evals/` folder with one folder per case (`prompt.md` with the request, graders such as `regex`, `tool_used` or an `llm` pass/fail rubric), with no Stigmer-specific format;
- push the folder as an eval: `stigmer push eval ./<folder> --name <eval-name>` (optionally `--tag stable`, `-m` a message), each changed push a new version;
- run it on the Agent now, as the baseline: `stigmer eval run --agent <agent> --eval <eval-name>` (or **Run evals** on the Agent's **Evals** tab); each case runs several times (3 by default) and every try is scored;
- change the instructions (a new Agent version, `stigmer apply`), run the same eval again, and compare the two eval runs case by case (each is stamped with the Agent's and the eval's version; **Compare** in the console highlights the cases whose score changed);
- that every try is a real run billed to the Organization's own provider keys, with a required cost limit (`--max-cost-usd`, 5 by default from the CLI).
Welcome but optional: pass^k, the threshold and the exit codes for CI; `--agent <agent>@<version>` to evaluate a named version; mocks standing in for MCP servers; the Quality tab's per-version table of live runs after the change; turning past bad conversations into cases with `stigmer runs to-eval-case`; going back by applying the earlier definition, which points the Agent back at that version; pinning a tag so product conversations start on `stable`.

FAIL if the answer invents a Stigmer test format, a "staging" or "draft" Agent mode, or commands and flags the docs don't name; says eval tries are free; tells them to build their own test harness or judge instead of using evals; or offers only "try it by hand in the chat and see".
