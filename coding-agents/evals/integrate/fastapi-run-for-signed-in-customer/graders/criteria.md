---
type: llm
---

PASS if the answer gives a Python flow the docs support, with Stigmer's key kept on the backend:
- the backend builds `StigmerClient` with a service account's API key read from the environment (`StigmerClient(os.environ["STIGMER_API_KEY"])`), never sent to the browser;
- the request starts the work with `client.send_and_wait(...)` or `client.runs.create(RunInput(...))`, naming the Agent in the session spec (`SessionSpecInput(agent_ref=ResourceRef(org=..., slug=...))`, which starts a new Session) or an existing `session_id` to continue the customer's conversation;
- it streams with `client.sessions.stream_events(io_pb2.StreamSessionEventsRequest(session_id=..., after_seq=0))`, keeps the events of its run (`run_id`, empty `thread_id`), joins the text blocks of `agent_message` events, and stops when a `stigmer_run_status` event's phase is `completed`, `failed`, `cancelled` or `terminated`, relaying each piece to the page in whatever way FastAPI streams (for example a `StreamingResponse` or server-sent events);
- it deals honestly with "for the signed-in customer": a run started with the service account's key is the service account's, so to have the conversation belong to the customer the docs' path is to mint a token for them with `client.tokens.mint_user_token(org=..., user_id=..., user_email=..., user_name=...)` (an admin service account, account creation on in the embedding settings) and run the chat in the browser with that token, or to give each customer their own Organization; it says which it chose and why, or names the gap.
Welcome but optional: resuming a dropped stream from the last `seq` with `after_seq`; previews through `event_deltas` for word-by-word text; a `waiting` phase meaning a call waits for an approval, answered with `client.sessions.confirm_tool_use`; `stigmer app-handover --stack python`.

FAIL if the answer puts the API key in the browser or front-end code; invents SDK calls, parameters or REST endpoints the docs don't name (such as a `stream=True` flag on `send_and_wait`, `client.agents.run(...)`, a webhook callback, or an "on behalf of user" header); claims Stigmer has no streaming and tells them to poll; tells them to build their own agent loop or call the model provider directly; or says nothing about whose conversation the run becomes.
