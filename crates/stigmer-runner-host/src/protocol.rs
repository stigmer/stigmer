//! Manager-mode IPC message types — the Rust mirror of the runner's contract.
//!
//! Hand-maintained mirror of `backend/services/runner/src/ipc-protocol.ts`, kept honest by
//! the `tests` module below, which asserts every message against the golden fixtures
//! generated from that file (vendored at `../fixtures/ipc-protocol.generated.json`). The
//! canonical human contract and the rule for keeping mirrors in sync live at
//! <https://stigmer.ai/docs/guides/runners/ipc-protocol>. The wire-level `camelCase`
//! rename below is the protocol's on-the-wire shape (the runner emits camelCase), not a
//! JS-host concern — so it belongs here in the core, unlike the Tauri-only shapes that
//! live in the `tauri` binding module.

use serde::{Deserialize, Serialize};

/// Integer protocol version this crate speaks. Bump ONLY on a breaking change (removed or
/// renamed message, changed field type, changed lifecycle guarantee); additive fields never
/// bump it. Hosts compare this against the runner's advertised version to decide
/// compatibility — see [`crate::host`] negotiation.
pub const IPC_PROTOCOL_VERSION: u32 = 1;

/// Commands the host writes to the runner's stdin (newline-delimited JSON).
#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum IpcCommand {
    #[serde(rename_all = "camelCase")]
    AddSession { session_id: String },
    #[serde(rename_all = "camelCase")]
    RemoveSession { session_id: String },
    #[serde(rename_all = "camelCase")]
    AddWorkflowExecution { execution_id: String },
    #[serde(rename_all = "camelCase")]
    RemoveWorkflowExecution { execution_id: String },
    UpdateToken { token: Option<String> },
    Shutdown,
}

/// Responses the runner emits on its stdout (newline-delimited JSON).
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
// Several variants/fields are deserialized for completeness but not all are read by the
// fire-and-forget driver (it tracks intended state locally). Keeping them faithful to the
// contract is the point of a mirror, so silence the unused-field lint rather than drop them.
#[allow(dead_code)]
pub enum IpcResponse {
    #[serde(rename_all = "camelCase")]
    Ready {
        // Optional so a pre-version-1 runner that omits the field still deserializes; the
        // host treats absence as version 1. See the IPC spec "Protocol version" section.
        #[serde(default)]
        protocol_version: Option<u32>,
    },
    #[serde(rename_all = "camelCase")]
    SessionAdded {
        session_id: String,
        task_queue: String,
    },
    #[serde(rename_all = "camelCase")]
    SessionRemoved { session_id: String },
    #[serde(rename_all = "camelCase")]
    WorkflowExecutionAdded {
        execution_id: String,
        task_queue: String,
    },
    #[serde(rename_all = "camelCase")]
    WorkflowExecutionRemoved { execution_id: String },
    TokenUpdated,
    Error { message: String, fatal: bool },
    ShutdownComplete,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    // The golden wire fixtures, generated from backend/services/runner/src/ipc-protocol.ts
    // and vendored here so this crate stays self-contained. Embedding (rather than reading
    // at runtime) means a deleted/renamed fixture is a compile error, and the bytes travel
    // with `cargo publish`. Keep it fresh with `make gen-ipc-fixtures`.
    const FIXTURES: &str = include_str!("../fixtures/ipc-protocol.generated.json");

    fn fixtures() -> Value {
        serde_json::from_str(FIXTURES).expect("golden IPC fixtures must be valid JSON")
    }

    // Backward-compatibility contract: the host must parse `ready` whether or not the
    // runner sends protocolVersion. An older runner omits it. See the IPC spec.
    #[test]
    fn ready_parses_with_protocol_version() {
        let resp: IpcResponse =
            serde_json::from_str(r#"{"type":"ready","protocolVersion":1}"#).unwrap();
        match resp {
            IpcResponse::Ready { protocol_version } => {
                assert_eq!(protocol_version, Some(1), "should read the advertised version");
            }
            other => panic!("expected Ready, got {other:?}"),
        }
    }

    #[test]
    fn ready_parses_without_protocol_version() {
        let resp: IpcResponse = serde_json::from_str(r#"{"type":"ready"}"#).unwrap();
        match resp {
            IpcResponse::Ready { protocol_version } => {
                assert_eq!(protocol_version, None, "absent field must default to None");
            }
            other => panic!("expected Ready, got {other:?}"),
        }
    }

    #[test]
    fn protocol_version_is_one() {
        assert_eq!(IPC_PROTOCOL_VERSION, 1, "bump only on a breaking IPC change");
    }

    // The version this crate speaks must equal the version the canonical contract stamps.
    #[test]
    fn protocol_version_matches_fixtures() {
        assert_eq!(
            fixtures()["ipcProtocolVersion"].as_u64(),
            Some(IPC_PROTOCOL_VERSION as u64),
            "crate IPC_PROTOCOL_VERSION drifted from the golden fixtures — regenerate or reconcile",
        );
    }

    // Every command this host emits must serialize to the exact golden wire shape. Comparing
    // parsed `Value`s (not strings) keeps the assertion independent of serde's key order.
    #[test]
    fn commands_match_golden_fixtures() {
        let commands = &fixtures()["commands"];
        let cases: [(&str, IpcCommand); 7] = [
            (
                "addSession",
                IpcCommand::AddSession { session_id: "ses_example".into() },
            ),
            (
                "removeSession",
                IpcCommand::RemoveSession { session_id: "ses_example".into() },
            ),
            (
                "addWorkflowExecution",
                IpcCommand::AddWorkflowExecution { execution_id: "wfe_example".into() },
            ),
            (
                "removeWorkflowExecution",
                IpcCommand::RemoveWorkflowExecution { execution_id: "wfe_example".into() },
            ),
            (
                "updateTokenSet",
                IpcCommand::UpdateToken { token: Some("tok_example".into()) },
            ),
            (
                "updateTokenCleared",
                IpcCommand::UpdateToken { token: None },
            ),
            ("shutdown", IpcCommand::Shutdown),
        ];
        for (name, command) in cases {
            let serialized = serde_json::to_value(&command).unwrap();
            assert_eq!(
                &serialized, &commands[name],
                "command `{name}` drifted from the golden fixture",
            );
        }
    }

    // Every response the runner emits must deserialize from the golden wire shape into the
    // expected typed variant — including the legacy `ready` that omits protocolVersion.
    #[test]
    fn responses_match_golden_fixtures() {
        let r = &fixtures()["responses"];
        let from = |key: &str| -> IpcResponse {
            serde_json::from_value(r[key].clone())
                .unwrap_or_else(|e| panic!("response `{key}` failed to deserialize: {e}"))
        };

        assert!(matches!(
            from("ready"),
            IpcResponse::Ready { protocol_version: Some(1) }
        ));
        assert!(matches!(
            from("readyLegacy"),
            IpcResponse::Ready { protocol_version: None }
        ));
        match from("sessionAdded") {
            IpcResponse::SessionAdded { session_id, task_queue } => {
                assert_eq!(session_id, "ses_example");
                assert_eq!(task_queue, "session:ses_example");
            }
            other => panic!("expected SessionAdded, got {other:?}"),
        }
        match from("sessionRemoved") {
            IpcResponse::SessionRemoved { session_id } => assert_eq!(session_id, "ses_example"),
            other => panic!("expected SessionRemoved, got {other:?}"),
        }
        match from("workflowExecutionAdded") {
            IpcResponse::WorkflowExecutionAdded { execution_id, task_queue } => {
                assert_eq!(execution_id, "wfe_example");
                assert_eq!(task_queue, "wfexec:wfe_example");
            }
            other => panic!("expected WorkflowExecutionAdded, got {other:?}"),
        }
        match from("workflowExecutionRemoved") {
            IpcResponse::WorkflowExecutionRemoved { execution_id } => {
                assert_eq!(execution_id, "wfe_example")
            }
            other => panic!("expected WorkflowExecutionRemoved, got {other:?}"),
        }
        assert!(matches!(from("tokenUpdated"), IpcResponse::TokenUpdated));
        match from("error") {
            IpcResponse::Error { message, fatal } => {
                assert_eq!(message, "boom");
                assert!(fatal);
            }
            other => panic!("expected Error, got {other:?}"),
        }
        assert!(matches!(from("shutdownComplete"), IpcResponse::ShutdownComplete));
    }
}
