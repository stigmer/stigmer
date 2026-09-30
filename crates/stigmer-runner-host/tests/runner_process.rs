//! `RunnerHost` against a real child process.
//!
//! The unit tests in `src/host.rs` cover the pure seams (the handshake parse, the
//! environment, the line forwarder). These drive the lifecycle itself — `start`,
//! `stop`, `kill` and the commands in between — against a real Node process speaking
//! the runner's side of the IPC protocol (`tests/fixtures/fake-runner.mjs`), so what
//! is proven is what the desktop depends on:
//!
//! - a ready runner is started in manager mode with the host's environment, and
//!   receives the commands the host sends, once each;
//! - a runner that exits, errors or speaks a newer protocol before it is ready is a
//!   typed start failure, and leaves no process behind;
//! - `stop` shuts a healthy runner down over IPC, and force-kills one that ignores
//!   the shutdown; `kill` ends it at once; either way the process is gone;
//! - a fatal error the runner reports later marks it as not running.
//!
//! They need `node` on `PATH`, as `ci.crate.yaml` and a developer machine have it;
//! without it they fail, since a missing `node` there is a broken machine.
#![cfg(unix)]

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use stigmer_runner_host::{RunnerConfig, RunnerHost, RunnerHostError};

fn node_on_path() -> String {
    let path = std::env::var_os("PATH").expect("PATH is set");
    std::env::split_paths(&path)
        .map(|dir| dir.join("node"))
        .find(|candidate| candidate.is_file())
        .unwrap_or_else(|| panic!("these tests need `node` on PATH; none was found"))
        .to_string_lossy()
        .into_owned()
}

fn fixture() -> String {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/fake-runner.mjs")
        .to_string_lossy()
        .into_owned()
}

/// A log file of its own for each test, removed when the test's guard drops.
struct RunnerLog(PathBuf);

impl RunnerLog {
    fn new() -> Self {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let name = format!(
            "stigmer-runner-host-{}-{}.log",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::SeqCst)
        );
        let path = std::env::temp_dir().join(name);
        let _ = std::fs::remove_file(&path);
        RunnerLog(path)
    }

    /// The pid the runner recorded on its first line.
    fn pid(&self) -> u32 {
        let lines = self.wait_for(1);
        lines
            .first()
            .and_then(|line| line.strip_prefix("pid "))
            .and_then(|pid| pid.parse().ok())
            .unwrap_or_else(|| panic!("the runner recorded no pid: {lines:?}"))
    }

    fn lines(&self) -> Vec<String> {
        std::fs::read_to_string(&self.0)
            .unwrap_or_default()
            .lines()
            .map(str::to_owned)
            .collect()
    }

    /// Wait (bounded) until the runner has recorded `count` lines.
    fn wait_for(&self, count: usize) -> Vec<String> {
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            let lines = self.lines();
            if lines.len() >= count || Instant::now() > deadline {
                return lines;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    }
}

impl Drop for RunnerLog {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

fn config(mode: &str, log: &RunnerLog) -> RunnerConfig {
    RunnerConfig {
        node_binary: node_on_path(),
        runner_entry: fixture(),
        temporal_address: None,
        stigmer_endpoint: "https://api.example.test".to_string(),
        temporal_namespace: None,
        stigmer_token: Some("tok-1".to_string()),
        cursor_api_key: None,
        anthropic_api_key: None,
        openai_api_key: None,
        workspace_root_dir: None,
        proxy_endpoint: None,
        local_artifact_path: None,
        extra_env: [
            ("FAKE_RUNNER_MODE".to_string(), mode.to_string()),
            (
                "FAKE_RUNNER_LOG".to_string(),
                log.0.to_string_lossy().into_owned(),
            ),
        ]
        .into_iter()
        .collect(),
    }
}

/// The crate's own idiom (its unit tests build the runtime the same way): a
/// current-thread runtime with the IO and time drivers, no test macros.
fn block_on<F: std::future::Future>(fut: F) -> F::Output {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("current-thread runtime")
        .block_on(fut)
}

/// A silent host, so the tests' output stays readable.
fn host() -> RunnerHost {
    RunnerHost::with_log_sink(Arc::new(|_line| {}))
}

/// Whether a process with this pid still exists.
fn alive(pid: u32) -> bool {
    std::process::Command::new("kill")
        .args(["-0", &pid.to_string()])
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn wait_until_gone(pid: u32) -> bool {
    let deadline = Instant::now() + Duration::from_secs(5);
    while alive(pid) {
        if Instant::now() > deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    true
}

#[test]
fn a_ready_runner_starts_in_manager_mode_with_the_hosts_environment() {
    let log = RunnerLog::new();
    let host = host();
    block_on(async {
        host.start(config("ready", &log)).await.expect("start");
        let status = host.status().await;
        assert!(status.running);
        assert!(status.pid.is_some());
        host.stop().await.expect("stop");
    });

    let env = log
        .lines()
        .into_iter()
        .nth(1)
        .expect("the runner recorded its env");
    assert_eq!(
        env,
        r#"env {"mode":"manager","token":"tok-1","endpoint":"https://api.example.test"}"#
    );
}

#[test]
fn the_runner_receives_each_command_once_and_the_status_follows_them() {
    let log = RunnerLog::new();
    let host = host();
    block_on(async {
        host.start(config("ready", &log)).await.expect("start");
        host.add_session("s1").await.expect("add s1");
        host.add_session("s1").await.expect("add s1 again");
        host.add_workflow_execution("e1").await.expect("add e1");
        host.update_token(Some("tok-2".into()))
            .await
            .expect("token");
        host.remove_session("s1").await.expect("remove s1");
        host.remove_session("never-added")
            .await
            .expect("remove unknown");

        let status = host.status().await;
        assert!(status.active_sessions.is_empty());
        assert_eq!(status.active_workflow_executions, vec!["e1".to_string()]);
    });

    let lines = log.wait_for(6);
    assert_eq!(
        lines[2..].to_vec(),
        vec![
            r#"{"type":"addSession","sessionId":"s1"}"#,
            r#"{"type":"addWorkflowExecution","executionId":"e1"}"#,
            r#"{"type":"updateToken","token":"tok-2"}"#,
            r#"{"type":"removeSession","sessionId":"s1"}"#,
        ]
    );
    block_on(host.kill());
}

#[test]
fn a_second_start_is_refused_while_one_runs() {
    let log = RunnerLog::new();
    let host = host();
    block_on(async {
        host.start(config("ready", &log)).await.expect("start");
        let second = host.start(config("ready", &log)).await;
        assert!(
            matches!(second, Err(RunnerHostError::AlreadyRunning)),
            "{second:?}"
        );
        host.kill().await;
    });
}

#[test]
fn stop_shuts_a_healthy_runner_down_over_ipc_and_the_process_is_gone() {
    let log = RunnerLog::new();
    let host = host();
    let pid = block_on(async {
        host.start(config("ready", &log)).await.expect("start");
        let pid = host.status().await.pid.expect("pid");
        host.stop().await.expect("stop");
        assert!(!host.status().await.running);
        pid
    });

    assert!(wait_until_gone(pid), "runner {pid} outlived stop()");
    assert_eq!(
        log.lines().last().map(String::as_str),
        Some(r#"{"type":"shutdown"}"#)
    );
}

#[test]
fn stop_force_kills_a_runner_that_ignores_the_shutdown() {
    // The escalation path (issue #177): a wedged runner never exits on the IPC
    // shutdown, so after the ten-second grace the host must SIGKILL and reap it.
    let log = RunnerLog::new();
    let host = host();
    let started = Instant::now();
    let pid = block_on(async {
        host.start(config("wedged", &log)).await.expect("start");
        let pid = host.status().await.pid.expect("pid");
        host.stop().await.expect("stop");
        pid
    });

    assert!(
        started.elapsed() >= Duration::from_secs(10),
        "stop returned before the grace"
    );
    assert!(wait_until_gone(pid), "wedged runner {pid} outlived stop()");
}

#[test]
fn kill_ends_the_runner_at_once_and_is_safe_to_repeat() {
    let log = RunnerLog::new();
    let host = host();
    let pid = block_on(async {
        host.start(config("wedged", &log)).await.expect("start");
        let pid = host.status().await.pid.expect("pid");
        let began = Instant::now();
        host.kill().await;
        assert!(
            began.elapsed() < Duration::from_secs(5),
            "kill waited on the runner"
        );
        host.kill().await;
        assert!(!host.status().await.running);
        pid
    });

    assert!(wait_until_gone(pid), "runner {pid} outlived kill()");
}

#[test]
fn stopping_a_host_with_no_runner_is_a_typed_error() {
    let host = host();
    let result = block_on(host.stop());
    assert!(
        matches!(result, Err(RunnerHostError::NotRunning)),
        "{result:?}"
    );
}

#[test]
fn a_runner_that_exits_before_ready_is_a_start_failure() {
    let log = RunnerLog::new();
    let host = host();
    let result = block_on(host.start(config("exit-before-ready", &log)));

    assert!(result.is_err(), "start must fail: {result:?}");
    assert!(!block_on(host.status()).running);
}

#[test]
fn a_startup_error_is_reported_with_its_message_and_the_child_is_reaped() {
    let log = RunnerLog::new();
    let host = host();
    let result = block_on(host.start(config("startup-error", &log)));

    match result {
        Err(RunnerHostError::RunnerStartup { message }) => {
            assert_eq!(message, "cannot reach the control plane");
        }
        other => panic!("expected a startup error, got {other:?}"),
    }
    assert!(!block_on(host.status()).running);
    let pid = log.pid();
    assert!(
        wait_until_gone(pid),
        "runner {pid} outlived its failed start"
    );
}

#[test]
fn a_runner_speaking_a_newer_protocol_is_refused_and_reaped() {
    let log = RunnerLog::new();
    let host = host();
    let result = block_on(host.start(config("newer-protocol", &log)));

    assert!(
        matches!(
            result,
            Err(RunnerHostError::ProtocolVersionMismatch { runner: 99, .. })
        ),
        "{result:?}"
    );
    assert!(!block_on(host.status()).running);
    let pid = log.pid();
    assert!(
        wait_until_gone(pid),
        "runner {pid} outlived its refused start"
    );
}

#[test]
fn a_fatal_error_reported_later_marks_the_runner_as_not_running() {
    let log = RunnerLog::new();
    let host = host();
    block_on(async {
        host.start(config("fatal-on-first-command", &log))
            .await
            .expect("start");
        host.add_session("s1").await.expect("add s1");

        let deadline = Instant::now() + Duration::from_secs(10);
        while host.status().await.running {
            assert!(
                Instant::now() < deadline,
                "the fatal error never took effect"
            );
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    });
}
