---
type: llm
---

PASS if the answer says that, with nothing to configure on the Agent, Stigmer asks for approval before an MCP tool whose server marks it destructive with the MCP annotation `destructiveHint: true`, so the fix is to set that annotation on `issue_refund` (and on `update_address` if it should ask too) in their own MCP server, leaving `lookup_order` unannotated so it runs without asking; the annotation is the server author's call and is read from the live server at the start of every turn. It also names hooks as the other documented way: a `PreToolUse` command hook (Claude Code or Cursor format, from a plugin or written in the Agent's `hooks`) can ask before that tool, or refuse it. And it says what happens then: the run pauses and waits (durably) until a person allows or denies the call, from the console, `stigmer runs approve`, or the Session's `confirmToolUse`.

Welcome but optional: `disallowed_tools` keeps an Agent away from a tool entirely; `stigmer connect plugin <name>` or **Check tools** marks which tools the server calls destructive; on a Slack, WhatsApp or public chat-link conversation there is no approver, so a call that asks is skipped there; `auto_approve_all` skips approvals and is for already-authorized automation.

FAIL if it invents an Agent or tool field for approvals (such as `require_approval`, `approval_tools`, `confirm: true`) or a console setting the docs don't name; says the way is to tell the model in its instructions to ask first; tells them to build their own pause or approval queue; recommends `auto_approve_all` or **Allow all** as the setup; or says a customer chatting over Slack, WhatsApp or a chat link gets the approval prompt.
