//! Manager-mode IPC message types — the Rust mirror of the runner's contract.
//!
//! Hand-maintained mirror of `backend/services/runner/src/ipc-protocol.ts`. The canonical
//! human contract and the rule for keeping mirrors in sync live at
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

    // Commands must serialize to the exact documented JSON: a `type` tag plus camelCase
    // fields. These assertions are the wire contract the runner deserializes against.
    #[test]
    fn commands_serialize_to_documented_json() {
        let cases = [
            (
                IpcCommand::AddSession { session_id: "ses_1".into() },
                r#"{"type":"addSession","sessionId":"ses_1"}"#,
            ),
            (
                IpcCommand::RemoveSession { session_id: "ses_1".into() },
                r#"{"type":"removeSession","sessionId":"ses_1"}"#,
            ),
            (
                IpcCommand::AddWorkflowExecution { execution_id: "wfe_1".into() },
                r#"{"type":"addWorkflowExecution","executionId":"wfe_1"}"#,
            ),
            (
                IpcCommand::RemoveWorkflowExecution { execution_id: "wfe_1".into() },
                r#"{"type":"removeWorkflowExecution","executionId":"wfe_1"}"#,
            ),
            (
                IpcCommand::UpdateToken { token: Some("tok".into()) },
                r#"{"type":"updateToken","token":"tok"}"#,
            ),
            (
                IpcCommand::UpdateToken { token: None },
                r#"{"type":"updateToken","token":null}"#,
            ),
            (IpcCommand::Shutdown, r#"{"type":"shutdown"}"#),
        ];
        for (command, expected) in cases {
            assert_eq!(serde_json::to_string(&command).unwrap(), expected);
        }
    }

    // Representative responses round-trip from the documented wire JSON into typed values.
    #[test]
    fn responses_deserialize_from_documented_json() {
        match serde_json::from_str(r#"{"type":"sessionAdded","sessionId":"ses_1","taskQueue":"q"}"#)
            .unwrap()
        {
            IpcResponse::SessionAdded { session_id, task_queue } => {
                assert_eq!(session_id, "ses_1");
                assert_eq!(task_queue, "q");
            }
            other => panic!("expected SessionAdded, got {other:?}"),
        }
        match serde_json::from_str(r#"{"type":"error","message":"boom","fatal":true}"#).unwrap() {
            IpcResponse::Error { message, fatal } => {
                assert_eq!(message, "boom");
                assert!(fatal);
            }
            other => panic!("expected Error, got {other:?}"),
        }
        assert!(matches!(
            serde_json::from_str(r#"{"type":"shutdownComplete"}"#).unwrap(),
            IpcResponse::ShutdownComplete
        ));
    }
}
