// The keys and commands of the live session `stigmer run` and `stigmer
// resume` open on a terminal, as both commands' help prints them (and the
// generated command pages with it). The commands themselves are the
// composer's (resources/stream/composer.ts); this is their words, kept light
// so `--help` loads no part of the session view.

/** What `--help` says about how a run returns and the code it exits with. */
export const UNTIL_HELP = `
How it ends:
  On a terminal the session stays open for follow-ups until you leave
  (--until exit, the default); --until turn returns when the turn ends.
  Off a terminal, and with -o json, it returns when the turn ends.

Exit codes (the newest turn's):
  0    the turn completed
  1    the turn failed, was cancelled or was stopped
  130  you left while the turn still works
`;

/** What `--help` says about the session a terminal opens. */
export const SESSION_HELP = `
In the session (on a terminal):
  Enter                       send the message
  \\ Enter, Ctrl+J, Alt+Enter  start a new line (Shift+Enter where the terminal reports it)
  Up, Down                    earlier messages, kept per directory
  Esc                         stop the agent's turn; twice while it stops, end it now
  Ctrl+C                      clear the message; on an empty one, twice to leave
                              (the agent keeps working: come back with stigmer resume)
  Shift+Tab, Ctrl+T           switch plan and agent mode
  Ctrl+O                      expand tool calls and thinking
  ?                           list the keys and commands

Commands:
  /help                       list the commands and keys
  /mode plan|agent            switch the mode
  /stop                       stop the agent's turn
  /exit                       leave; the agent keeps working
  @<path>                     mention a file in the session's folder
`;
