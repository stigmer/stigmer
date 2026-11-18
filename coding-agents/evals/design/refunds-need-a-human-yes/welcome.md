What a good answer may also say. Never graded: leaving any of it out fails nothing.

- It names both ways: the `destructiveHint: true` annotation and a `PreToolUse` command hook (Claude Code or Cursor format), which can also refuse the tool.
- `update_address` gets the annotation too if it should ask.
- The annotation is the server author's call and is read from the live server at the start of every turn.
- `disallowed_tools` keeps an Agent away from a tool entirely.
- `stigmer connect plugin <name>` or **Check tools** marks which tools the server calls destructive.
- On a Slack, WhatsApp or public chat-link conversation there is no approver, so a call that asks is skipped there.
- `auto_approve_all` skips approvals and is for automation a person has already authorized.
- A `PreToolUse` command hook can come from a plugin or be written in the Agent's `hooks`.
