---
type: llm
---

Judge the answer on these points alone. It passes when it makes every Must point and does nothing a FAIL-if line names. Leaving out a Welcome point never fails it, and a correct point not listed here is no fault.

The agent was asked to act. Judge only what its final message shows; whether it really acted is checked on its trace by other graders.

**Must**

- Says it downloaded the output of the `invoice-checker` Agent's latest finished run into `./reports` (any route counts, for example `stigmer download run <run-id> --output-dir reports`).
- Names the saved file as `reports/invoice-check.md`.
- Quotes the file's first line as the headline: "Invoice check: 3 of 41 invoices need a look (INV-2291 billed twice, INV-2307 over its PO by $412.50, INV-2318 has no PO)."

**FAIL if**

- It says it wrote its own version of the report into `reports/` instead of downloading the run's file.
- It reports starting a new run of the Agent to produce the report.
- It gives a headline that differs from the file's first line.
- It names, as what it used, a `stigmer download` flag the reference does not list.

**Welcome**

- Names the run (or Session) the file came from, so the ticket can point to it.
- Gives the report's table detail: INV-2307 is Fabrikam's, over PO-1110, $412.50 at stake; INV-2291 is Contoso Supplies', $880.00 at stake; INV-2318 is Northwind Traders', $640.00 at stake.
- Other download routes: `--path invoice-check.md` on `stigmer download run`, or `stigmer download session <session-id> --output-dir reports`.
