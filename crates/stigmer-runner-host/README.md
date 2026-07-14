# stigmer-runner-host

Embed the [Stigmer](https://stigmer.ai) runner as a manager-mode subprocess and drive it
over its stdin/stdout JSON IPC — without hand-rolling the spawn, handshake, and lifecycle
plumbing.

`RunnerHost` is the framework-agnostic driver (no Tauri dependency in the default build).
A `tauri` feature adds the desktop binding (`RunnerState` + the `#[tauri::command]`
surface). The Stigmer desktop app is its first consumer.

## Usage

```rust
use stigmer_runner_host::{RunnerHost, RunnerConfig};

let host = RunnerHost::new();
host.start(RunnerConfig {
    node_binary: "node".into(),
    // Absolute path. In a packaged app, resolve it from the resource directory
    // (e.g. Tauri's `app.path().resolve(.., BaseDirectory::Resource)`) — `node`
    // resolves a relative entry against the working directory, which is `/` for a
    // GUI app. A path that does not resolve fails fast with `RunnerEntryNotFound`.
    runner_entry: "/path/to/resources/runner/dist/main.js".into(),
    temporal_address: Some("localhost:7233".into()),
    stigmer_endpoint: "http://localhost:7234".into(),
    temporal_namespace: None,
    stigmer_token: None,
    cursor_api_key: None,
    anthropic_api_key: None,
    openai_api_key: None,
    workspace_root_dir: None,
    proxy_endpoint: None,
    extra_env: Default::default(),
})
.await?;

host.add_session("ses_abc123").await?;
// ... later
host.remove_session("ses_abc123").await?;
host.stop().await?;
```

The crate does not bundle the Node runner; point `node_binary` + `runner_entry` at an
installed `@stigmer/runner`.

## LLM credentials (BYOK / direct mode)

The runner resolves model credentials in one of two modes, decided by `proxy_endpoint`:

- **Proxy mode** (`proxy_endpoint: Some(..)`) — model traffic routes through the Stigmer
  proxy, which injects provider keys server-side. The runner authenticates with
  `stigmer_token`; do not pass provider keys. This is how the Stigmer desktop app runs
  against Stigmer Cloud.
- **Direct mode** (`proxy_endpoint: None`) — the runner calls the providers itself with
  keys you supply: `anthropic_api_key` and/or `openai_api_key` for the native harness,
  `cursor_api_key` for the Cursor harness. Without them, executions fail at model-call
  time with `LLM_MISSING_API_KEY`.

Pass credentials through these typed fields, not by mutating your own process
environment before `start()` — the spawn env is composed from the config, so the typed
fields are the supported channel (and the only discoverable one).

`extra_env` forwards any additional environment to the spawned runner (for example
`LOG_LEVEL`, or `STIGMER_RUNNER_HITL_SECRET` to pin a HITL fingerprint key across
replicas). Keys the host owns — everything the crate composes itself, including the
credential vars above — are **reserved**: `start()` rejects them with
`ReservedEnvKey`, pointing at the typed field to use instead.

## Tauri binding

```toml
stigmer-runner-host = { version = "0.1", features = ["tauri"] }
```

Manage a `RunnerState` and register the nine commands (`start_runner`, `stop_runner`,
`kill_runner`, `add_session`, `remove_session`, `add_workflow_execution`,
`remove_workflow_execution`, `update_runner_token`, `runner_status`) in
`tauri::generate_handler!`.

Reap the runner on app exit from your `RunEvent::Exit` handler with `RunnerState::kill()` —
relying on `kill_on_drop` alone is only a soft guarantee:

```rust
app.run(|app_handle, event| {
    if let tauri::RunEvent::Exit = event {
        tauri::async_runtime::block_on(app_handle.state::<RunnerState>().kill());
    }
});
```

Use `kill()`, **not** `stop()`, on the exit path. `stop()` is a *graceful* shutdown whose
bounded wait relies on the tokio time driver — which is no longer pumped at `RunEvent::Exit`.
With a mid-execution runner that never acks the shutdown, a `block_on(stop())` there parks
forever (issue #178). `kill()` is a timer-free SIGKILL-then-reap and cannot park. Reserve
`stop()` for an explicit in-app stop while the event loop is still healthy.

## Protocol version compatibility

The crate speaks `IPC_PROTOCOL_VERSION` (currently `1`). On the `ready` handshake it
reconciles its version against the runner's: a runner advertising a **higher** version is
rejected with `RunnerHostError::ProtocolVersionMismatch` (this host is too old to
understand it). The version bumps only on a breaking change; additive changes never bump
it, so equal or lower runner versions are accepted.

This crate is a hand-maintained mirror of
`backend/services/runner/src/ipc-protocol.ts`. The canonical contract is the
[manager-mode IPC protocol reference](https://stigmer.ai/docs/guides/runners/ipc-protocol).
The mirror is kept honest by golden fixtures generated from that file: the conformance
tests in `src/protocol.rs` assert against the vendored
`fixtures/ipc-protocol.generated.json`, so a contract change that is not mirrored here
fails `cargo test`. Regenerate the fixtures with `make gen-ipc-fixtures` from the repo root.
