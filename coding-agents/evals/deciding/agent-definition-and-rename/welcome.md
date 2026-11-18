What a good answer may also say. Never graded: leaving any of it out fails nothing.

- Each Session remembers the Agent version it started on, so updating the Agent doesn't change conversations under way.
- An apply states the whole resource, so applying the same file twice changes nothing.
- The old slug keeps leading to the resource for 30 days, and no other resource of the kind can take it meanwhile.
- A write through the old slug is refused with a message naming the new one.
- Renaming needs the same permission as deleting.
- `stigmer get agent <slug> -o yaml` prints a file carrying both the `id` and the `slug`.
- On Stigmer Cloud only the time an Agent spends working on a Session counts as agent hours; time waiting is never counted.
- References show the new slug after a rename.
