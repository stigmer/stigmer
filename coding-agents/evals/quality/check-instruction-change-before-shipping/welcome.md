What a good answer may also say. Never graded: leaving any of it out fails nothing.

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
