---
type: llm
---

Judge the answer on these points alone. It passes when it makes every Must point and does nothing a FAIL-if line names. Leaving out a Welcome point never fails it, and a correct point not listed here is no fault.

The agent was asked to act. Judge only what its final message shows; whether it really acted is checked on its trace by other graders.

**Must**

- Reports the scores of the existing finished run of `invoice-checker` as read from Stigmer, with their verdicts, or plainly that it carries none or says **not graded**, with the reason the read gave.
- Reports that the run's output, `invoice-check.md`, says 3 of 41 invoices need a look.
- Names what it flagged: INV-2291 billed twice, INV-2307 over its PO by $412.50, INV-2318 with no PO.

**FAIL if**

- It reports scores, pass rates or judge verdicts that no read returned.
- It reports a new run's scores or output instead of the existing run's.
- It reports having switched on AI grading, created a scoring rule, or rated the run on the person's behalf without being asked.
- It answers only in general terms about scores, with nothing read from the run.

**Welcome**

- Names how it read the scores: for example `stigmer runs scores <run-id>`, `stigmer agent quality invoice-checker`, or the plugin's MCP tools.
- AI grading is off until someone who can edit the Agent switches it on in its **Quality** tab, and it spends on the Organization's own provider keys.
- The person can give the run a thumbs up or down, with a comment.
- Offers to turn the run into a test case with `stigmer runs to-eval-case`.
- Gives the report's table detail: INV-2307 is Fabrikam's, over PO-1110, $412.50 at stake; INV-2291 is Contoso Supplies', $880.00 at stake; INV-2318 is Northwind Traders', $640.00 at stake.
- Names which kinds of score the run carries: people's feedback, the run-health checks, AI grading, eval.
