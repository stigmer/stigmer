---
type: llm
---

PASS if the answer says starting a conversation with an Agent needs two things: a role on the Agent (Viewer or higher, or general access that reaches you) and the Organization's Member role or higher; and names the likely causes with their fixes: the Agent's general access is Private (it reaches only its creator, the people it is shared with and the Organization's admins), so its creator or an admin opens it, chooses Manage access, and shares it with this person (a Viewer of an Agent can run it) or sets general access to Organization; or this person's Organization role is Viewer, which sees what is shared and starts no conversation, so an admin makes them a Member. Welcome but optional: checking the active Organization (`stigmer config context show`, or `--org` before the subcommand) and who they are signed in as (`stigmer auth whoami`); per-resource sharing is an Enterprise and Cloud feature.

FAIL if it suggests using the coworker's API key, sign-in or credentials; invents a CLI command, flag or setting for sharing that the docs don't name; says members can never run Agents other people made; or makes the person an admin or Owner as the fix without naming the narrower one.
