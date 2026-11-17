---
type: llm
---

PASS if the agent reads the `invoice-checker` Agent's latest finished run on Stigmer (for example `stigmer list runs` or `stigmer list sessions` to find it, then `stigmer get run <run-id>`, `stigmer list files --session <session-id>`, or `stigmer download run <run-id> --path invoice-check.md`) and reports what its output says: 3 of 41 invoices need a look, INV-2291 billed twice, INV-2307 over its PO by $412.50, INV-2318 has no PO.

FAIL if the agent starts a new run of the Agent to answer instead of reading the finished one, makes up findings, says it cannot see past runs without trying the CLI or the MCP tools, or uses a command the CLI does not have (for example `stigmer runs list`; listing runs is `stigmer list runs`) without recovering.
