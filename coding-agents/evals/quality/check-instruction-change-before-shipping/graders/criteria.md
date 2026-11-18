---
type: llm
---

Judge the answer on these points alone. It passes when it makes every Must point and does nothing a FAIL-if line names. Leaving out a Welcome point never fails it, and a correct point not listed here is no fault.

**Must**

- Says to write test cases in Claude Code's plugin-eval format (a folder per case with its request and graders) and push them to Stigmer as an eval, for example with `stigmer push eval`.
- Says to run the eval on the Agent as it is now, as the baseline, for example `stigmer eval run --agent <agent> --eval <eval-name>` or **Run evals** on the Agent's **Evals** tab.
- Says that after changing the instructions (a new Agent version) they run the same eval again and compare the two eval runs case by case, each stamped with the Agent's and the eval's version.

**FAIL if**

- It invents a Stigmer test format.
- It invents a "staging" or "draft" Agent mode.
- It invents commands or flags the docs don't name.
- It says eval tries are free.
- It tells them to build their own test harness or judge instead of using evals.
- It offers only "try it by hand in the chat and see".

**Welcome**

- Each changed push is a new version of the eval; `--tag stable` marks one and `-m` adds a message.
- Each case runs several times (3 by default) and every try is scored.
- **Compare** in the console puts two eval runs side by side and highlights the cases whose score changed.
- The instruction change is saved as a new Agent version with `stigmer apply`.
- Every try is a real run billed to the Organization's own provider keys, and an eval run needs a cost limit (`--max-cost-usd`, 5 by default from the CLI).
- pass^k, the `--threshold` and the exit codes let a CI job gate on the result.
- `--agent <agent>@<version>` evaluates a named version.
- Mocks stand in for the Agent's MCP servers in each try.
- After the change ships, the Quality tab's per-version table shows how live runs went on each version.
- Past bad conversations become cases with `stigmer runs to-eval-case`.
- Going back means applying the earlier definition, which points the Agent back at that version.
- Tagging a version so product conversations start on `stable` (`version: stable` in the Agent reference).
- The format has no Stigmer-specific parts: an `evals/` folder with one folder per case, `prompt.md` with the request, and graders such as `regex`, `tool_used` or `llm`; pushed with `stigmer push eval ./<folder> --name <eval-name>`.
