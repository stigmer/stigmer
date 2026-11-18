---
type: llm
---

Judge the answer on these points alone. It passes when it makes every Must point and does nothing a FAIL-if line names. Leaving out a Welcome point never fails it, and a correct point not listed here is no fault.

**Must**

- Says yes, through AI grading: an AI judge grades a sample of the Agent's finished runs, off until someone who can edit the Agent switches it on (for example in its **Quality** tab).
- On cost, says they bound it by grading one run in N and by a monthly dollar limit, and that the judge runs on their Organization's own provider keys.
- Says their customers in the embedded chat don't see grades: scores show in the console to people who can see the run, never in an embedded chat or chat link.
- Says live grading uses Stigmer's four standard rubrics with no setting for their own; their own criteria go in eval test cases (for example an `llm` grader) run as evals.

**FAIL if**

- It says AI grading is on by default, or free.
- It invents a setting or API for custom live-grading rubrics.
- It claims the judge runs on Stigmer's keys or bills the customer.
- It says embedded chat users see the grades.
- It tells them to build their own LLM-judge pipeline as the only way.

**Welcome**

- The sample runs from every run to one in a hundred, and which runs are picked is fixed by each run's id.
- Each grade sets aside its maximum cost, $0.25, before it starts, so a limit below $0.25 grades no run; the Quality tab shows this month's spend and how many runs were graded.
- The judge's model can be picked; otherwise it is the platform's default.
- The judge runs as a run of its own, never as part of the graded run, and has no tools; when no key fits its model, the run says **not graded: the judge could not start**.
- The four rubrics are `did-the-task`, `made-nothing-up`, `acted-only-as-asked` and `asked-when-unclear`.
- Run health checks every completed run for free, with no AI model.
- The Quality tab shows the last 7, 30 or 90 days, a chart per measure, a table per Agent version, and flagged runs (`stigmer agent quality <agent> --flagged`).
- People's thumbs on the final answer are feedback scores, and `stigmer agent quality <agent> --agreement` compares them with the judge per rubric.
- The quality report shows counts only, never anyone's words; an Organization's admins don't see the scores of a personal conversation.
- A grade is a signal to look closer, not a final verdict, since a run's text can try to sway the judge.
- The **Quality** tab and `stigmer agent quality <agent>` show how the runs are going over time.
- A run left ungraded because the limit was reached says **not graded** and never counts as a failure.
- The four rubrics are the same in every Organization; eval cases are run with `stigmer eval run`.
