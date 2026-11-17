---
type: llm
---

PASS if the agent finds the `invoice-checker` Agent's latest finished run and downloads its output with the CLI into `./reports` (for example `stigmer download run <run-id> --output-dir reports`, optionally `--path invoice-check.md`, or `stigmer download session <session-id> --output-dir reports`), so that `reports/invoice-check.md` holds the run's file, and then quotes its first line: "Invoice check: 3 of 41 invoices need a look (INV-2291 billed twice, INV-2307 over its PO by $412.50, INV-2318 has no PO)."

FAIL if the agent writes its own version of the report into `reports/` instead of downloading the run's file, starts a new run of the Agent, reports a headline that differs from the file's first line, or uses a `stigmer download` flag the reference does not list.
