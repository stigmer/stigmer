---
type: llm
---

Judge the answer on these points alone. It passes when it makes every Must point and does nothing a FAIL-if line names. Leaving out a Welcome point never fails it, and a correct point not listed here is no fault.

**Must**

- Says starting a conversation with an Agent needs two things: a role on the Agent (Viewer or higher, or general access that reaches you) and the Organization's Member role or higher.
- Names the Agent being Private as a likely cause, fixed by its creator or an admin sharing it with this person or setting its general access to Organization.
- Names this person holding the Organization's Viewer role as the other likely cause, fixed by an admin making them a Member.

**FAIL if**

- It suggests using the coworker's API key, sign-in or credentials.
- It invents a CLI command, flag or setting for sharing that the docs don't name.
- It says members can never run Agents other people made.
- It makes the person an admin or Owner as the fix without naming the narrower one.

**Welcome**

- Checking the active Organization (`stigmer config context show`, or `--org` before the subcommand).
- Checking who they are signed in as (`stigmer auth whoami`).
- Per-resource sharing is an Enterprise and Cloud feature.
- A Private Agent reaches only its creator, the people it is shared with and the Organization's admins; sharing is under the Agent's Manage access, and a Viewer of an Agent can run it.
- An Organization Viewer sees what is shared and starts no conversation.
