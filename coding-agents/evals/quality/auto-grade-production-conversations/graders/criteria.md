---
type: llm
---

PASS if the answer explains Scores as the docs do:
- **AI grading** is off until someone who can edit the Agent switches it on in the Agent's **Quality** tab, choosing how many runs to grade (one in N, every run to one in a hundred), a monthly limit in US dollars (each grade sets aside its maximum, $0.25, before it starts) and optionally the judge's model;
- the judge runs on the provider keys of the Organization the run belongs to, as a run of its own; when the limit is reached or no key fits, the run says **not graded** and is never counted as a failure;
- the judge answers Stigmer's four standard rubrics (`did-the-task`, `made-nothing-up`, `acted-only-as-asked`, `asked-when-unclear`), the same in every Organization: there is no setting for their own criteria on live runs; their own checks belong in eval test cases (an `llm` grader with their PASS/FAIL rubric), run with `stigmer eval run`;
- **run health** checks every completed run for free, with no AI model;
- watching for slipping: the Quality tab (and `stigmer agent quality <agent>`) shows the last 7, 30 or 90 days, a chart per measure, a table per Agent version, and flagged runs (`--flagged`);
- who sees grades: scores follow the run; pages built for someone else's product, such as an embedded chat or a chat link, show none, so their customers don't see them.
Welcome but optional: people's thumbs as feedback; `--agreement` to compare thumbs with the judge per rubric; the report shows counts only, never anyone's words; admins don't see the scores of a personal conversation; a grade is a signal to look closer, since a run's text can try to sway the judge.

FAIL if the answer says AI grading is on by default or free; invents a setting or API for custom live-grading rubrics; claims the judge runs on Stigmer's keys or bills the customer; says embedded chat users see the grades; or tells them to build their own LLM-judge pipeline as the only way.
