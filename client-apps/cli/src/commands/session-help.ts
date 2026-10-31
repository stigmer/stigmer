// The keys and commands of the live session `stigmer run` and `stigmer
// resume` open on a terminal, as both commands' help prints them (and the
// generated command pages with it). The commands themselves are the
// composer's (resources/stream/composer.ts); this is their words, kept light
// so `--help` loads no part of the session view.

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
