---
type: llm
---

PASS if the agent runs the `invoice-checker` Agent on Stigmer with `samples/march.csv` given to the run (for example `stigmer run invoice-checker --attach samples/march.csv -m "..."`, with `--download <dir>` and `--until turn`, or by reading the run's outputs afterwards with `stigmer download run <run-id>` or `stigmer download session <session-id>`), gets the output file the run saved (`invoice-check.md`), and tells the person what it says: 3 of 41 invoices need a look, INV-2291 billed twice, INV-2307 over its PO by $412.50, INV-2318 with no PO. Saying where the file now sits on disk is welcome. Noting that the report names invoice numbers the CSV does not contain is welcome, not required.

FAIL if the agent checks the CSV itself instead of running the Agent, makes up findings the run's output does not contain, reports the run as done without having read its output, uses a `stigmer run` or `stigmer download` flag the CLI reference does not list, or changes or deletes the `invoice-checker` Agent or its Skill.
