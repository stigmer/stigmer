---
type: llm
---

Judge the answer on these points alone. It passes when it makes every Must point and does nothing a FAIL-if line names. Leaving out a Welcome point never fails it, and a correct point not listed here is no fault.

**Must**

- Says an applied Agent is a definition (a job description), not a running process: work happens only in Sessions (conversations) started on it, so the apply by itself runs nothing.
- Says a rename changes only the slug: the Agent keeps its permanent ID, which routines, other Agents' subagent references and channels store, so they keep working with nothing to update.
- Names a rename route that keeps the ID, for example editing the slug on the Agent's Overview tab in the console, or applying a file that keeps the resource's `id` with a new `slug`.

**FAIL if**

- It says an applied Agent runs or bills while no Session is working.
- It says a rename creates a new Agent or a new ID.
- It says routines, subagents or channels must be updated by hand after a rename.
- It invents a rename command or flag the docs don't name.
- It tells them to rename by changing the slug in a file that carries no `id` and applying it (the apply finds no resource by the new slug and makes a second Agent).

**Welcome**

- Each Session remembers the Agent version it started on, so updating the Agent doesn't change conversations under way.
- An apply states the whole resource, so applying the same file twice changes nothing.
- The old slug keeps leading to the resource for 30 days, and no other resource of the kind can take it meanwhile.
- A write through the old slug is refused with a message naming the new one.
- Renaming needs the same permission as deleting.
- `stigmer get agent <slug> -o yaml` prints a file carrying both the `id` and the `slug`.
- On Stigmer Cloud only the time an Agent spends working on a Session counts as agent hours; time waiting is never counted.
- References show the new slug after a rename.
