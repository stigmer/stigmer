---
type: llm
---

Judge the answer on these points alone. It passes when it makes every Must point and does nothing a FAIL-if line names. Leaving out a Welcome point never fails it, and a correct point not listed here is no fault.

**Must**

- Builds the Python client on the backend with a service account's API key read from the environment (for example `StigmerClient(os.environ["STIGMER_API_KEY"])`), never sent to the browser.
- Starts a run on the Agent, for example `client.runs.create` or `client.send_and_wait` naming the Agent in the session spec, or an existing session id to continue the customer's conversation.
- Streams the Session's events, relays the Agent's message text to the page as it comes (for example a `StreamingResponse` or server-sent events), and stops when the run reaches a final phase.
- Says a run on the service account's key is the service account's; it belongs to the customer only through a token minted for them or an Organization per customer, and says which it chose or names the gap.

**FAIL if**

- It puts the API key in the browser or front-end code.
- It invents SDK calls, parameters or REST endpoints the docs don't name (such as a `stream=True` flag on `send_and_wait`, `client.agents.run(...)`, a webhook callback, or an "on behalf of user" header).
- It claims Stigmer has no streaming and tells them to poll.
- It tells them to build their own agent loop or call the model provider directly.
- It says nothing about whose conversation the run becomes.

**Welcome**

- Minting needs account creation on in the Organization's embedding settings.
- Resuming a dropped stream from the last `seq` with `after_seq`.
- Previews through `event_deltas` for word-by-word text.
- A `waiting` phase means a call waits for an approval, answered with `client.sessions.confirm_tool_use`.
- `stigmer app-handover --stack python`.
- The calls: `RunInput(...)` with `SessionSpecInput(agent_ref=ResourceRef(org=..., slug=...))` starts a new Session; `client.sessions.stream_events(io_pb2.StreamSessionEventsRequest(session_id=..., after_seq=0))` streams; the text is the joined text blocks of `agent_message` events, and the end is a `stigmer_run_status` event whose phase is `completed`, `failed`, `cancelled` or `terminated`.
- Minting is `client.tokens.mint_user_token(org=..., user_id=..., user_email=..., user_name=...)` with an admin service account, its token used by the chat in the browser.
