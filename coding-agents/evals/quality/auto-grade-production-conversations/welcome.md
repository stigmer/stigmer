What a good answer may also say. Never graded: leaving any of it out fails nothing.

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
