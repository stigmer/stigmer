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
    runner_entry: "resources/runner/dist/main.js".into(),
    temporal_address: "localhost:7233".into(),
    stigmer_endpoint: "http://localhost:7234".into(),
    temporal_namespace: None,
    stigmer_token: None,
    cursor_api_key: None,
    workspace_root_dir: None,
    proxy_endpoint: None,
})
.await?;

host.add_session("ses_abc123").await?;
// ... later
host.remove_session("ses_abc123").await?;
host.stop().await?;
```

The crate does not bundle the Node runner; point `node_binary` + `runner_entry` at an
installed `@stigmer/runner`.

## Tauri binding

```toml
stigmer-runner-host = { version = "0.1", features = ["tauri"] }
```

Manage a `RunnerState` and register the eight commands (`start_runner`, `stop_runner`,
`add_session`, `remove_session`, `add_workflow_execution`, `remove_workflow_execution`,
`update_runner_token`, `runner_status`) in `tauri::generate_handler!`.

## Protocol version compatibility

The crate speaks `IPC_PROTOCOL_VERSION` (currently `1`). On the `ready` handshake it
reconciles its version against the runner's: a runner advertising a **higher** version is
rejected with `RunnerHostError::ProtocolVersionMismatch` (this host is too old to
understand it). The version bumps only on a breaking change; additive changes never bump
it, so equal or lower runner versions are accepted.

This crate is a hand-maintained mirror of
`backend/services/runner/src/ipc-protocol.ts`. The canonical contract is the
[manager-mode IPC protocol reference](https://stigmer.ai/docs/guides/runners/ipc-protocol).
