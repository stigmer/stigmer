What a good answer may also say. Never graded: leaving any of it out fails nothing.

- Minting needs account creation on in the Organization's embedding settings.
- Resuming a dropped stream from the last `seq` with `after_seq`.
- Previews through `event_deltas` for word-by-word text.
- A `waiting` phase means a call waits for an approval, answered with `client.sessions.confirm_tool_use`.
- `stigmer app-handover --stack python`.
- The calls: `RunInput(...)` with `SessionSpecInput(agent_ref=ResourceRef(org=..., slug=...))` starts a new Session; `client.sessions.stream_events(io_pb2.StreamSessionEventsRequest(session_id=..., after_seq=0))` streams; the text is the joined text blocks of `agent_message` events, and the end is a `stigmer_run_status` event whose phase is `completed`, `failed`, `cancelled` or `terminated`.
- Minting is `client.tokens.mint_user_token(org=..., user_id=..., user_email=..., user_name=...)` with an admin service account, its token used by the chat in the browser.
