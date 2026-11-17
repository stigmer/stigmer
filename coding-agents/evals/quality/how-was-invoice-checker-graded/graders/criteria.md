---
type: llm
---

PASS if the agent reads the existing finished run of `invoice-checker` on the person's Stigmer and reports:
- what that run's scores are, as read from Stigmer (for example with `stigmer runs scores <run-id>`, `stigmer agent quality invoice-checker`, or the plugin's MCP tools): which kinds of score it carries (people's feedback, the run-health checks, AI grading, eval) and their verdicts, or plainly that it carries none or says **not graded**, with the reason the read gave;
- what the run handed back, from its output file `invoice-check.md`: 3 of 41 invoices need a look, INV-2291 billed twice, INV-2307 over its PO by $412.50, INV-2318 with no PO.
Welcome but optional: that AI grading is off until someone who can edit the Agent switches it on in its Quality tab, and costs model spend; that the person can give the run a thumbs up or down; offering to turn the run into a test case with `stigmer runs to-eval-case`.

FAIL if the agent invents scores, pass rates or judge verdicts that no read returned; reports a new run's scores or output instead of the existing run's; switches on AI grading, creates a scoring rule, or rates the run on the person's behalf without asking; or answers only in general terms without reading the run.
