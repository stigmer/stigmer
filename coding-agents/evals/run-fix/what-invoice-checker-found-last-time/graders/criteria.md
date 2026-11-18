---
type: llm
---

Judge the answer on these points alone. It passes when it makes every Must point and does nothing a FAIL-if line names. Leaving out a Welcome point never fails it, and a correct point not listed here is no fault.

The agent was asked to act. Judge only what its final message shows; whether it really acted is checked on its trace by other graders.

**Must**

- Says its answer comes from the `invoice-checker` Agent's latest finished run on Stigmer, read as it is, not from a new run.
- Reports that the run's output says 3 of 41 invoices need a look.
- Names the flagged invoices with what is wrong with each: INV-2291 billed twice, INV-2307 over its PO by $412.50, INV-2318 has no PO.

**FAIL if**

- It reports starting a new run of the Agent to answer instead of reading the finished one.
- It reports findings the run's output does not contain.
- It says it cannot see past runs and gives no findings.
- It gives, as the way to read the run, a command the CLI does not have (for example `stigmer runs list`; listing runs is `stigmer list runs`).

**Welcome**

- Names how it read the run: for example `stigmer list runs` or `stigmer list sessions` to find it, then `stigmer list files --session <session-id>`, or `stigmer download run <run-id> --path invoice-check.md`.
- Names the output file, `invoice-check.md`.
- Gives the report's table detail: INV-2307 is Fabrikam's, over PO-1110, $412.50 at stake; INV-2291 is Contoso Supplies', $880.00 at stake; INV-2318 is Northwind Traders', $640.00 at stake.
