---
type: llm
---

PASS if the answer says an Agent is a definition (a job description), not a running process: work happens in Sessions (conversations) started on it, each of which remembers the Agent version it started on, and an apply states the whole resource, so applying the same file twice changes nothing. On renaming it must say every resource has a permanent ID that never changes and a slug that can be renamed; a rename changes only the slug; references (a routine's Agent, another Agent's subagent, a channel) store the ID, so they keep working and show the new slug, with nothing to update. It must also say the old slug keeps leading to the resource for 30 days and no other resource of the kind can take it meanwhile, and how to rename: in the console (the slug on the Agent's Overview tab, then Rename) or by keeping the resource's `id` in the file, changing its `slug` and applying it. Welcome but optional: a write through the old slug is refused with a message naming the new one; renaming needs the same permission as deleting; `stigmer get agent <slug> -o yaml` prints a file carrying both id and slug.

FAIL if it says an applied Agent runs or bills while no Session is working; that a rename creates a new Agent or a new ID; that routines, subagents or channels must be updated by hand after a rename; or invents a rename command or flag the docs don't name.
