//! The PATH a person's terminal sees, for the tools their agents run.
//!
//! An app opened from Finder, the Dock or a desktop launcher inherits the
//! session's bare PATH (`/usr/bin:/bin:/usr/sbin:/sbin` on macOS), not the one
//! the person's shell builds from its rc files. An agent's tool server
//! started as `npx …`, or a shell step calling `brew`, `uv` or an nvm-managed
//! `node`, then fails with "command not found" although it works in their
//! terminal (stigmer/stigmer#1347).
//!
//! So at start the app asks the person's login shell once, in the background,
//! the way VS Code does for the same reason: it runs the shell as an
//! interactive login shell (`-i -l -c`) with stdin closed and prints `$PATH`
//! between two markers, so a banner or a noisy rc file cannot corrupt the
//! answer, and gives up after five seconds. The shell is `$SHELL`, else the
//! account's login shell from the user database.
//!
//! Only PATH crosses. No other variable from the shell reaches the runner: a
//! tool still receives only the secrets it declares (declare-to-receive), and
//! the runner's own engine stays the Node this build carries, found by
//! absolute path (stigmer/stigmer#1068). When the shell fails or is too slow,
//! the app's own PATH is used and the reason is logged. Windows apps already
//! see the user's PATH, so there the app's own is the answer.

use std::time::Duration;

use tokio::sync::watch;

/// How long the login shell may take to print its PATH.
#[cfg(unix)]
const SHELL_TIMEOUT: Duration = Duration::from_secs(5);

#[cfg(unix)]
const START_MARKER: &str = "__STIGMER_PATH_START__";
#[cfg(unix)]
const END_MARKER: &str = "__STIGMER_PATH_END__";

/// The resolved PATH, shared with [`user_tool_path`]; `None` until the
/// background read finishes.
pub struct UserPath(watch::Receiver<Option<String>>);

impl UserPath {
    /// Starts reading the person's PATH on a background thread and returns
    /// the handle the command waits on.
    pub fn resolve_in_background() -> Self {
        let (tx, rx) = watch::channel(None);
        std::thread::spawn(move || {
            let _ = tx.send(Some(resolve()));
        });
        Self(rx)
    }
}

/// The PATH the embedded runner should give the tools it starts. Waits for
/// the background read, which gives up after five seconds.
#[tauri::command]
pub async fn user_tool_path(state: tauri::State<'_, UserPath>) -> Result<String, String> {
    let mut rx = state.0.clone();
    let resolved = rx
        .wait_for(Option::is_some)
        .await
        .map_err(|_| "The app stopped reading your shell's PATH before it finished.".to_string())?;
    Ok(resolved.clone().unwrap_or_default())
}

/// The app's own PATH, the answer whenever the shell's cannot be read.
fn own_path() -> String {
    std::env::var("PATH").unwrap_or_default()
}

#[cfg(not(unix))]
fn resolve() -> String {
    own_path()
}

#[cfg(unix)]
fn resolve() -> String {
    let Some(shell) = unix::login_shell() else {
        eprintln!(
            "stigmer: could not find your login shell ($SHELL is unset and the user database \
             names none); agents' tools use the app's own PATH"
        );
        return own_path();
    };
    match unix::read_path_from(&shell, SHELL_TIMEOUT) {
        Ok(path) => path,
        Err(reason) => {
            eprintln!(
                "stigmer: could not read PATH from your shell {}: {reason}; agents' tools use \
                 the app's own PATH",
                shell.display()
            );
            own_path()
        }
    }
}

/// The text between the markers, when the shell printed both and something
/// between them. Pure, so the parsing is tested apart from any shell.
#[cfg(unix)]
pub(crate) fn parse_marked(output: &str) -> Option<String> {
    let start = output.find(START_MARKER)? + START_MARKER.len();
    let rest = &output[start..];
    let end = rest.find(END_MARKER)?;
    let path = rest[..end].trim();
    (!path.is_empty()).then(|| path.to_string())
}

#[cfg(unix)]
mod unix {
    use std::ffi::CStr;
    use std::io::Read;
    use std::os::unix::process::CommandExt;
    use std::path::{Path, PathBuf};
    use std::process::{Command, Stdio};
    use std::sync::mpsc;
    use std::time::Duration;

    use super::{parse_marked, END_MARKER, START_MARKER};

    /// `$SHELL` when it names an absolute path, else the account's login shell.
    pub(super) fn login_shell() -> Option<PathBuf> {
        if let Some(shell) = std::env::var_os("SHELL").map(PathBuf::from) {
            if shell.is_absolute() {
                return Some(shell);
            }
        }
        account_shell()
    }

    /// The login shell the user database names for this account.
    fn account_shell() -> Option<PathBuf> {
        // SAFETY: getpwuid returns a pointer into static storage owned by libc,
        // or null. It is read at once, on this thread, and copied out before
        // any other call could reuse that storage.
        unsafe {
            let entry = libc::getpwuid(libc::getuid());
            if entry.is_null() || (*entry).pw_shell.is_null() {
                return None;
            }
            let shell = CStr::from_ptr((*entry).pw_shell).to_str().ok()?;
            (!shell.is_empty()).then(|| PathBuf::from(shell))
        }
    }

    /// Runs `shell` as an interactive login shell that prints PATH between the
    /// markers, and returns what it printed there. The shell is killed after
    /// `timeout`, or once both markers have arrived, whichever comes first.
    ///
    /// The shell runs in a session of its own, with no controlling terminal:
    /// an interactive shell in the app's process group would take a launching
    /// terminal's foreground and keep it once killed. Killing its process
    /// group also ends whatever its rc files started.
    pub(crate) fn read_path_from(shell: &Path, timeout: Duration) -> Result<String, String> {
        let script = format!("printf '%s%s%s' '{START_MARKER}' \"$PATH\" '{END_MARKER}'");
        let mut command = Command::new(shell);
        command
            .args(["-i", "-l", "-c", &script])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        // SAFETY: setsid is async-signal-safe and touches only the child,
        // between fork and exec.
        unsafe {
            command.pre_exec(|| {
                if libc::setsid() == -1 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
        let mut child = command
            .spawn()
            .map_err(|e| format!("it would not start ({e})"))?;

        let mut stdout = child.stdout.take().ok_or("its output could not be read")?;
        let (tx, rx) = mpsc::channel();
        // Read until the end marker or the end of the output. A process the rc
        // files leave in the background can hold the pipe open, so the reader
        // stops at the marker rather than waiting for the pipe to close.
        std::thread::spawn(move || {
            let mut seen = Vec::new();
            let mut chunk = [0u8; 4096];
            loop {
                match stdout.read(&mut chunk) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        seen.extend_from_slice(&chunk[..n]);
                        if String::from_utf8_lossy(&seen).contains(END_MARKER) {
                            break;
                        }
                    }
                }
            }
            let _ = tx.send(String::from_utf8_lossy(&seen).into_owned());
        });

        let outcome = rx.recv_timeout(timeout);
        // The shell leads its own group (setsid), so its pid names the group.
        if let Ok(group) = libc::pid_t::try_from(child.id()) {
            // SAFETY: a negative pid signals that process group alone.
            unsafe {
                libc::kill(-group, libc::SIGKILL);
            }
        }
        let _ = child.kill();
        let status = child.wait();
        match outcome {
            Ok(output) => parse_marked(&output).ok_or_else(|| match status {
                Ok(status) if !status.success() => format!("it exited with {status}"),
                _ => "it printed no PATH".to_string(),
            }),
            Err(_) => Err(format!("it took longer than {timeout:?}")),
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    use std::path::{Path, PathBuf};

    /// A stand-in shell: a script that runs whatever `-c` gave it under `body`.
    fn fake_shell(dir: &Path, body: &str) -> PathBuf {
        let path = dir.join("fake-shell");
        std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        path
    }

    #[test]
    fn the_path_is_the_text_between_the_markers() {
        let output = format!("{START_MARKER}/opt/homebrew/bin:/usr/bin{END_MARKER}");
        assert_eq!(
            parse_marked(&output).as_deref(),
            Some("/opt/homebrew/bin:/usr/bin")
        );
    }

    #[test]
    fn noise_around_the_markers_is_ignored() {
        let output =
            format!("Last login: Sun Nov  1\nWelcome!\n{START_MARKER}/a:/b{END_MARKER}\nbye\n");
        assert_eq!(parse_marked(&output).as_deref(), Some("/a:/b"));
    }

    #[test]
    fn a_missing_marker_or_an_empty_path_is_no_answer() {
        assert_eq!(parse_marked("/a:/b"), None);
        assert_eq!(parse_marked(&format!("{START_MARKER}/a:/b")), None);
        assert_eq!(parse_marked(&format!("/a:/b{END_MARKER}")), None);
        assert_eq!(parse_marked(&format!("{START_MARKER}{END_MARKER}")), None);
        assert_eq!(parse_marked(&format!("{END_MARKER}/a{START_MARKER}")), None);
    }

    #[test]
    fn the_shell_s_path_is_read_through_its_rc_noise() {
        let dir = tempfile::tempdir().unwrap();
        // Prints a banner, as a noisy rc file would, then runs the command
        // with the PATH the person's rc files would have built.
        let shell = fake_shell(
            dir.path(),
            "echo 'rc banner'\nPATH=/opt/homebrew/bin:/usr/bin exec /bin/sh -c \"$4\"",
        );
        assert_eq!(
            unix::read_path_from(&shell, Duration::from_secs(5)).as_deref(),
            Ok("/opt/homebrew/bin:/usr/bin")
        );
    }

    #[test]
    fn the_shell_is_started_as_an_interactive_login_shell() {
        let dir = tempfile::tempdir().unwrap();
        // Prints its first two arguments where PATH would be.
        let shell = fake_shell(
            dir.path(),
            &format!("printf '%s%s%s%s' '{START_MARKER}' \"$1\" \"$2\" '{END_MARKER}'"),
        );
        assert_eq!(
            unix::read_path_from(&shell, Duration::from_secs(5)).as_deref(),
            Ok("-i-l")
        );
    }

    #[test]
    fn a_shell_that_hangs_is_given_up_on() {
        let dir = tempfile::tempdir().unwrap();
        let shell = fake_shell(dir.path(), "sleep 30");
        let started = std::time::Instant::now();
        let outcome = unix::read_path_from(&shell, Duration::from_millis(300));
        assert_eq!(outcome, Err("it took longer than 300ms".to_string()));
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "the hung shell was waited on"
        );
    }

    #[test]
    fn the_shell_runs_in_a_session_of_its_own_so_it_never_takes_the_terminal() {
        let dir = tempfile::tempdir().unwrap();
        // Prints its process group and its pid where PATH would be. An
        // interactive shell sharing the app's group would take a launching
        // terminal's foreground, and keep it when killed (Ctrl+C then no
        // longer reaches `make desktop-dev`).
        let shell = fake_shell(
            dir.path(),
            &format!(
                "printf '%s%s %s%s' '{START_MARKER}' \"$(ps -o pgid= -p $$ | tr -d ' ')\" \"$$\" '{END_MARKER}'"
            ),
        );
        let answer = unix::read_path_from(&shell, Duration::from_secs(5)).unwrap();
        let (group, pid) = answer.split_once(' ').unwrap();
        assert_eq!(group, pid, "the shell ran in the app's process group");
    }

    #[test]
    fn what_the_shell_started_ends_with_it() {
        let dir = tempfile::tempdir().unwrap();
        let started = dir.path().join("started");
        // An rc file that leaves a process behind, then the PATH, then a
        // shell that would linger: the reader stops at the end marker and
        // ends the whole group.
        let shell = fake_shell(
            dir.path(),
            &format!(
                "sleep 30 &\necho $! > '{}'\nprintf '%s%s%s' '{START_MARKER}' /a '{END_MARKER}'\nsleep 30",
                started.display()
            ),
        );
        assert_eq!(
            unix::read_path_from(&shell, Duration::from_secs(20)).as_deref(),
            Ok("/a")
        );
        let pid: i32 = std::fs::read_to_string(&started)
            .unwrap()
            .trim()
            .parse()
            .unwrap();
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        // SAFETY: kill with signal 0 only asks whether the pid exists.
        while unsafe { libc::kill(pid, 0) } == 0 {
            assert!(
                std::time::Instant::now() < deadline,
                "the process the shell started ({pid}) outlived it"
            );
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    #[test]
    fn a_shell_that_fails_says_how() {
        let dir = tempfile::tempdir().unwrap();
        let shell = fake_shell(dir.path(), "exit 3");
        let outcome = unix::read_path_from(&shell, Duration::from_secs(5)).unwrap_err();
        assert!(outcome.starts_with("it exited with"), "{outcome}");
    }

    #[test]
    fn a_shell_that_does_not_exist_says_it_would_not_start() {
        let outcome = unix::read_path_from(Path::new("/nonexistent/shell"), Duration::from_secs(5))
            .unwrap_err();
        assert!(outcome.starts_with("it would not start"), "{outcome}");
    }

    #[test]
    fn the_login_shell_is_found() {
        assert!(unix::login_shell().is_some());
    }
}
