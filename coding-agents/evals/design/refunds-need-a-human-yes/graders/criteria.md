---
type: llm
---

Judge the answer on these points alone. It passes when it makes every Must point and does nothing a FAIL-if line names. Leaving out a Welcome point never fails it, and a correct point not listed here is no fault.

**Must**

- Says approval comes from the tool, not an Agent setting: mark `issue_refund` destructive on their MCP server (the `destructiveHint: true` annotation), or add a `PreToolUse` hook that asks before it; `lookup_order` stays unmarked.
- Says the run then pauses and waits, durably, until a person allows or denies the call, for example in the console, with `stigmer runs approve`, or the Session's `confirmToolUse`.

**FAIL if**

- It invents an Agent or tool field for approvals (such as `require_approval`, `approval_tools` or `confirm: true`) or a console setting the docs don't name.
- It says the way is to tell the model in its instructions to ask first.
- It tells them to build their own pause or approval queue.
- It recommends `auto_approve_all` or **Allow all** as the setup.
- It says a customer chatting over Slack, WhatsApp or a chat link gets the approval prompt.

**Welcome**

- It names both ways: the `destructiveHint: true` annotation and a `PreToolUse` command hook (Claude Code or Cursor format), which can also refuse the tool.
- `update_address` gets the annotation too if it should ask.
- The annotation is the server author's call and is read from the live server at the start of every turn.
- `disallowed_tools` keeps an Agent away from a tool entirely.
- `stigmer connect plugin <name>` or **Check tools** marks which tools the server calls destructive.
- On a Slack, WhatsApp or public chat-link conversation there is no approver, so a call that asks is skipped there.
- `auto_approve_all` skips approvals and is for automation a person has already authorized.
- A `PreToolUse` command hook can come from a plugin or be written in the Agent's `hooks`.
