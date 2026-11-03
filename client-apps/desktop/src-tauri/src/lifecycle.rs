//! What the app does at each turn of its run loop.
//!
//! Tauri hands `lib.rs` every [`RunEvent`]; the few that matter here are
//! translated into a small [`Lifecycle`] and [`decide`] answers with the acts
//! to take, as a pure function of the event and the build. The choices are
//! therefore tested without a running app, the way `deep_link.rs` tests where
//! a URL goes; `lib.rs` only carries the acts out.
//!
//! The choices:
//! - closing the main window hides it in a release build, so agents keep
//!   running and the Dock icon brings it back; a dev build lets it close, so
//!   `tauri dev` stops when its window does;
//! - a click on the Dock icon while no window is visible brings the window
//!   back (macOS asks through `applicationShouldHandleReopen`);
//! - quitting saves the window's place, and the embedded runner is killed on
//!   the way out (issue #177; why `kill` and not `stop` is in `lib.rs`).

use tauri::{RunEvent, WindowEvent};

use crate::window::MAIN_WINDOW;

/// The run-loop events the app acts on.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Lifecycle {
    /// The person closed the main window (its red button, Cmd+W).
    MainWindowCloseRequested,
    /// The Dock icon was clicked while the app was running (macOS only).
    Reopen { has_visible_windows: bool },
    /// The app was asked to quit.
    ExitRequested,
    /// The app is quitting now.
    Exit,
}

impl Lifecycle {
    /// The event as the app sees it, or `None` for one it ignores.
    pub(crate) fn of(event: &RunEvent) -> Option<Self> {
        match event {
            RunEvent::WindowEvent {
                label,
                event: WindowEvent::CloseRequested { .. },
                ..
            } if label == MAIN_WINDOW => Some(Self::MainWindowCloseRequested),
            #[cfg(target_os = "macos")]
            RunEvent::Reopen {
                has_visible_windows,
                ..
            } => Some(Self::Reopen {
                has_visible_windows: *has_visible_windows,
            }),
            RunEvent::ExitRequested { .. } => Some(Self::ExitRequested),
            RunEvent::Exit => Some(Self::Exit),
            _ => None,
        }
    }
}

/// One thing the app does in answer to a [`Lifecycle`] event.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Act {
    /// Write the window's size and place, so the next launch opens it there.
    SaveWindowState,
    /// Keep the close from destroying the window.
    PreventClose,
    /// Hide the main window; the app keeps running.
    HideMainWindow,
    /// Show, restore and focus the main window (`window::bring_forward`).
    BringForward,
    /// Kill the embedded runner before the process exits.
    KillRunner,
}

/// The acts for one event, in the order they run. `is_dev` is true in a
/// debug build.
pub(crate) fn decide(event: Lifecycle, is_dev: bool) -> Vec<Act> {
    match event {
        Lifecycle::MainWindowCloseRequested if is_dev => vec![Act::SaveWindowState],
        Lifecycle::MainWindowCloseRequested => vec![Act::PreventClose, Act::HideMainWindow],
        Lifecycle::Reopen {
            has_visible_windows: false,
        } => vec![Act::BringForward],
        Lifecycle::Reopen {
            has_visible_windows: true,
        } => Vec::new(),
        Lifecycle::ExitRequested => vec![Act::SaveWindowState],
        Lifecycle::Exit => vec![Act::KillRunner],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_dock_click_with_no_window_showing_brings_the_window_back() {
        for is_dev in [false, true] {
            assert_eq!(
                decide(
                    Lifecycle::Reopen {
                        has_visible_windows: false
                    },
                    is_dev
                ),
                vec![Act::BringForward],
                "is_dev = {is_dev}"
            );
        }
    }

    #[test]
    fn a_dock_click_while_the_window_shows_leaves_it_to_macos() {
        assert!(decide(
            Lifecycle::Reopen {
                has_visible_windows: true
            },
            false
        )
        .is_empty());
    }

    #[test]
    fn closing_the_window_in_a_release_build_hides_it_and_keeps_the_app_running() {
        assert_eq!(
            decide(Lifecycle::MainWindowCloseRequested, false),
            vec![Act::PreventClose, Act::HideMainWindow]
        );
    }

    #[test]
    fn closing_the_window_in_a_dev_build_saves_its_place_and_lets_it_close() {
        assert_eq!(
            decide(Lifecycle::MainWindowCloseRequested, true),
            vec![Act::SaveWindowState]
        );
    }

    #[test]
    fn quitting_saves_the_window_then_kills_the_runner_on_exit() {
        for is_dev in [false, true] {
            assert_eq!(
                decide(Lifecycle::ExitRequested, is_dev),
                vec![Act::SaveWindowState]
            );
            assert_eq!(decide(Lifecycle::Exit, is_dev), vec![Act::KillRunner]);
        }
    }

    #[test]
    fn the_run_loop_events_translate_into_lifecycle_events() {
        assert_eq!(Lifecycle::of(&RunEvent::Exit), Some(Lifecycle::Exit));
        assert_eq!(Lifecycle::of(&RunEvent::Ready), None);
        assert_eq!(Lifecycle::of(&RunEvent::Resumed), None);
    }
}
