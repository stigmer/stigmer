# Manager-mode IPC protocol

The canonical, human-readable reference for the manager-mode stdin/stdout IPC
protocol now lives on the Stigmer documentation site:

**https://stigmer.ai/docs/guides/runners/ipc-protocol**

That page is the single source of truth for the command/response contract, the
versioned handshake, the lifecycle, and the backward-compatibility rules. Edit it
there — do not re-add the full prose here, so the contract has exactly one home.

The machine-readable definition of the protocol is the code itself:
[`../src/ipc-protocol.ts`](../src/ipc-protocol.ts) (notably `IPC_PROTOCOL_VERSION`
and the `Ipc*` interfaces). When you change the protocol, update both the code and
the documentation page, and bump `IPC_PROTOCOL_VERSION` if the change is breaking.
The Rust host crate (`crates/stigmer-runner-host/src/protocol.rs`, which the desktop
app consumes) and the Go harness (`test/integration/harness/unified_runner.go`) are
hand-maintained mirrors that must change together with it.
