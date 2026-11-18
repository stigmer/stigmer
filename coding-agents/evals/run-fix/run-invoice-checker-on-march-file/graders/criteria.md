---
type: llm
---

Judge the answer on these points alone. It passes when it makes every Must point and does nothing a FAIL-if line names. Leaving out a Welcome point never fails it, and a correct point not listed here is no fault.

The agent was asked to act. Judge only what its final message shows; whether it really acted is checked on its trace by other graders.

**Must**

- Says it ran the `invoice-checker` Agent on Stigmer with `samples/march.csv` given to the run (any route counts, for example attached with `--attach`).
- Reports what the run's saved output file, `invoice-check.md`, says: 3 of 41 invoices need a look.
- Names the three invoices to chase, with what is wrong with each: INV-2291 billed twice, INV-2307 over its PO by $412.50, INV-2318 with no PO.

**FAIL if**

- It presents findings it worked out from the CSV itself rather than from the run's output.
- It reports findings the run's output does not contain.
- It reports the run as done without saying what its output says.
- It names, as what it used, a `stigmer run` or `stigmer download` flag the CLI reference does not list.
- It reports having changed or deleted the `invoice-checker` Agent or its `vendor-aliases` Skill.

**Welcome**

- Says where `invoice-check.md` now sits on disk (for example the folder given to `--download`, or where `stigmer download run <run-id>` or `stigmer download session <session-id>` wrote it).
- Gives the report's table detail: INV-2307 is Fabrikam's, over PO-1110, $412.50 at stake; INV-2291 is Contoso Supplies', $880.00 at stake; INV-2318 is Northwind Traders', $640.00 at stake.
- Notes that the report names invoice numbers `samples/march.csv` does not contain (the file holds INV-3101 to INV-3141), so the findings deserve a check before chasing.
