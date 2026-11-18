What a good answer may also say. Never graded: leaving any of it out fails nothing.

- The stop reason is `requires_action`, naming the waiting tool use, and the waiting call shows as a `stigmer.permission.asked` event.
- A server restart resumes the same wait.
- A deny with a reason lets the agent adapt.
- Killing and retrying would only stop at the same approval again.
- `grantPermission` allows every call of its kind for the rest of the turn.
- On a channel or a chat link's guest there is no approver, so a tool that asks is skipped there.
- `stigmer runs logs` shows the tool use id.
- The tool use id is read from the Session's events.
- The quickstart's Agent sets `disallowed_tools: [Bash]`; approving ahead is `auto_approve_all` on the run.
