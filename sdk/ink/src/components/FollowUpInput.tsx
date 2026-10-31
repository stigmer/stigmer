// The session's composer: several lines, paste, history, and the host's slash
// commands and completions (input/extensions.ts), over the kit's one text
// field. Enter sends; `\` then Enter, Ctrl+J, Alt+Enter or Shift+Enter starts
// a new line. Up and Down walk the history from the first and last rows. A
// paste over 800 characters or three lines shows as "[Pasted text #1 +42
// lines]" and is sent whole. `/` at the start opens the host's commands, a
// source's trigger its completions; Tab or Enter takes the selected item,
// Esc closes the menu. `?` on an empty composer lists the keys and commands.
//
// The draft is kept while the composer cannot send (a turn waits on a
// person, a message is on its way), so nothing typed is lost. Ctrl+C clears a
// draft; on an empty composer it is the session's (SessionView: leave). Esc
// twice clears a draft, into the history, when Esc does not stop a turn.
//
// Proven by __tests__/composer.test.tsx.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useInput, type Key } from "ink";
import { useRoles } from "../theme.js";
import { useKeyClaim } from "../app/key-owner.js";
import { TextField } from "./TextField.js";
import { EMPTY_BUFFER, bufferOf, insertText, type TextBuffer } from "../input/text-buffer.js";
import {
  NO_WALK,
  acceptMenuItem,
  appendHistory,
  attachmentsOf,
  commandInsert,
  expandPastes,
  matchCommands,
  menuQuery,
  parseCommand,
  pasteInsert,
  stepHistory,
  type HistoryWalk,
} from "../input/composer-logic.js";
import type { CompletionAttachment, CompletionItem, ComposerContext, ComposerExtensions } from "../input/extensions.js";

/** Props for {@link FollowUpInput}. */
export interface FollowUpInputProps {
  /** Called with the message the person sends, and what its completions attach. */
  readonly onSubmit: (message: string, attach?: CompletionAttachment) => void;
  /** Shows a "sending" indicator; the draft stays. */
  readonly isSubmitting?: boolean;
  /** Keeps the draft but does not send or edit it (a turn waits on a person). */
  readonly disabled?: boolean;
  /** Placeholder text. Default: "Reply..." */
  readonly placeholder?: string;
  /** Current interaction mode. Shown in the default hint line. */
  readonly mode?: "agent" | "plan";
  /** The host's commands, completions and history. */
  readonly composer?: ComposerExtensions;
  /** What a host command can do; commands are not run without it. */
  readonly context?: ComposerContext;
  /** The hint line under the composer, in place of the default. */
  readonly hint?: string;
  /** Told whether the composer holds a draft, so Ctrl+C on an empty one can mean leave. */
  readonly onDraftChange?: (hasDraft: boolean) => void;
  /** Whether Esc twice clears the draft; off while Esc stops a working turn. Defaults to `true`. */
  readonly escapeClears?: boolean;
  /** Whether the composer reads keys at all. Defaults to `true`. */
  readonly active?: boolean;
}

/** How long two presses of Esc may be apart to clear the draft. */
const DOUBLE_ESCAPE_MS = 800;
/** The most rows a menu shows. */
const MENU_ROWS = 6;

/** One row of an open menu. */
interface MenuRow {
  readonly label: string;
  readonly detail?: string;
  readonly insert: string;
  readonly item?: CompletionItem;
}

/**
 * Terminal composer for follow-up messages in a session (module header).
 *
 * Enter sends; `\` then Enter, Ctrl+J or Alt+Enter starts a new line; Up and
 * Down recall earlier messages; Ctrl+C clears a draft.
 */
export function FollowUpInput({
  onSubmit,
  isSubmitting = false,
  disabled = false,
  placeholder = "Reply...",
  mode,
  composer,
  context,
  hint,
  onDraftChange,
  escapeClears = true,
  active = true,
}: FollowUpInputProps) {
  const role = useRoles();
  const [buffer, setBuffer] = useState<TextBuffer>(EMPTY_BUFFER);
  const [walk, setWalk] = useState<HistoryWalk>(NO_WALK);
  const [entries, setEntries] = useState<readonly string[]>([]);
  const [pastes, setPastes] = useState<ReadonlyMap<string, string>>(new Map());
  const [accepted, setAccepted] = useState<readonly CompletionItem[]>([]);
  const [completions, setCompletions] = useState<readonly CompletionItem[]>([]);
  const [selected, setSelected] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<string | undefined>(undefined);
  const [helpShown, setHelpShown] = useState(false);
  const lastEscape = useRef(0);

  const commands = useMemo(() => composer?.commands ?? [], [composer]);
  const sources = useMemo(() => composer?.completions ?? [], [composer]);
  const editable = active && !disabled && !isSubmitting;

  // The history: the host's, loaded once, or this session's own.
  useEffect(() => {
    let live = true;
    void Promise.resolve(composer?.history?.load() ?? []).then((loaded) => {
      if (live) setEntries(loaded);
    });
    return () => {
      live = false;
    };
  }, [composer]);

  useEffect(() => {
    onDraftChange?.(buffer.text !== "");
  }, [buffer.text, onDraftChange]);

  // The menu the cursor is in, and a source's items for it.
  const query = useMemo(() => menuQuery(buffer, sources.map((source) => source.trigger)), [buffer, sources]);
  const queryKey = query === undefined ? undefined : `${query.kind}:${query.start}:${query.query}`;
  useEffect(() => {
    setSelected(0);
    if (query?.kind !== "completion") {
      setCompletions([]);
      return;
    }
    const source = sources.find((candidate) => candidate.trigger === query.trigger);
    if (source === undefined) return;
    const controller = new AbortController();
    void Promise.resolve(source.complete(query.query, controller.signal))
      .then((items) => {
        if (!controller.signal.aborted) setCompletions(items);
      })
      .catch(() => {
        if (!controller.signal.aborted) setCompletions([]);
      });
    return () => controller.abort();
    // Stryker disable next-line ArrayDeclaration: the query's key names everything the effect reads from it
  }, [queryKey, sources]);

  const rows: readonly MenuRow[] =
    query === undefined || queryKey === dismissedAt
      ? []
      : query.kind === "command"
        ? matchCommands(commands, query.query).map((command) => ({
            label: `/${command.name}${command.args ? ` ${command.args}` : ""}`,
            detail: command.description,
            insert: commandInsert(command),
          }))
        : completions.map((item) => ({ label: item.label, detail: item.detail, insert: item.insert, item }));
  const menuOpen = editable && rows.length > 0;
  useKeyClaim(menuOpen);

  const clear = (): void => {
    setBuffer(EMPTY_BUFFER);
    setWalk(NO_WALK);
    setPastes(new Map());
    setAccepted([]);
  };

  const remember = (entry: string): void => {
    setEntries((list) => appendHistory(list, entry));
    void composer?.history?.append(entry);
  };

  const submit = (sent: TextBuffer = buffer): void => {
    const text = sent.text.trim();
    if (text === "") return;
    const run = parseCommand(text, commands);
    if (run !== undefined && context !== undefined) {
      remember(text);
      clear();
      void run.command.run(run.args, context);
      return;
    }
    const message = expandPastes(text, pastes);
    remember(message);
    onSubmit(message, attachmentsOf(text, accepted));
    clear();
  };

  const accept = (row: MenuRow): void => {
    if (query === undefined) return;
    setBuffer(acceptMenuItem(buffer, query, row.insert));
    if (row.item !== undefined) setAccepted((list) => [...list, row.item!]);
  };

  // Keys the composer takes before its field: the open menu's, `?`, and the
  // draft's Ctrl+C and double Esc.
  const intercept = (input: string, key: Key): boolean => {
    if (helpShown) setHelpShown(false);
    if (menuOpen) {
      if (key.upArrow || key.downArrow) {
        setSelected((index) => (index + (key.upArrow ? rows.length - 1 : 1)) % rows.length);
        return true;
      }
      if (key.tab || key.return) {
        const row = rows[Math.min(selected, rows.length - 1)]!;
        // Enter on a command already typed in full runs it, as Enter would.
        if (key.return && query?.kind === "command" && buffer.text.trim() === row.insert) {
          submit();
          return true;
        }
        accept(row);
        return true;
      }
      if (key.escape) {
        setDismissedAt(queryKey);
        return true;
      }
    }
    if (input === "?" && buffer.text === "" && !key.ctrl && !key.meta) {
      setHelpShown((shown) => !shown);
      return true;
    }
    return false;
  };

  // The draft's own keys, read whether or not it can be edited, so a draft
  // typed while a turn waits can still be cleared.
  useInput(
    (input, key) => {
      if (key.ctrl && input === "c" && buffer.text !== "") {
        clear();
        return;
      }
      if (key.escape && escapeClears && !menuOpen && buffer.text !== "") {
        const now = Date.now();
        if (now - lastEscape.current <= DOUBLE_ESCAPE_MS) {
          remember(expandPastes(buffer.text.trim(), pastes));
          clear();
          lastEscape.current = 0;
        } else {
          lastEscape.current = now;
        }
      }
    },
    { isActive: active },
  );

  const visibleRows = rows.slice(0, MENU_ROWS);
  const defaultHint = `Enter to send · \\⏎ newline · Ctrl+T ${mode === "plan" ? "agent" : "plan"} mode`;

  return (
    <Box paddingLeft={1} paddingTop={1} flexDirection="column">
      {helpShown && <ComposerHelp commands={commands.map((command) => [`/${command.name}`, command.description] as const)} />}
      <Box gap={1}>
        <Text {...role.accent} bold>
          ❯
        </Text>
        {isSubmitting && buffer.text === "" ? (
          <Text dimColor>Sending...</Text>
        ) : (
          <TextField
            value={buffer}
            onChange={(next) => {
              setBuffer(next);
              if (walk.index !== undefined && next.text !== buffer.text) setWalk(NO_WALK);
            }}
            onSubmit={(value) => submit(value)}
            onHistory={(direction) => {
              const step = stepHistory(entries, walk, buffer.text, direction);
              if (step === undefined) return;
              setWalk(step.walk);
              setBuffer(bufferOf(step.text));
            }}
            onPaste={(text) => {
              const paste = pasteInsert(text, pastes.size + 1);
              if (paste.label !== undefined) setPastes((map) => new Map([...map, [paste.label!, text.replace(/\r\n?/g, "\n")]]));
              setBuffer(insertText(buffer, paste.insert));
            }}
            intercept={intercept}
            focus={editable}
            multiline
            atoms={[...pastes.keys()]}
            placeholder={placeholder}
          />
        )}
      </Box>
      {menuOpen && (
        <Box flexDirection="column" paddingLeft={2}>
          {visibleRows.map((row, index) => (
            <Box key={`${row.label}-${index}`} gap={2}>
              <Text {...(index === selected ? role.accent : {})}>{`${index === selected ? "▸" : " "} ${row.label}`}</Text>
              {row.detail !== undefined && <Text dimColor>{row.detail}</Text>}
            </Box>
          ))}
          {rows.length > MENU_ROWS && <Text dimColor>{`  ${rows.length - MENU_ROWS} more`}</Text>}
        </Box>
      )}
      <Box paddingLeft={2}>
        <Text dimColor>{hint ?? defaultHint}</Text>
      </Box>
    </Box>
  );
}

/** The keys, and the host's commands, as `?` lists them. */
function ComposerHelp({ commands }: { readonly commands: readonly (readonly [string, string])[] }) {
  const keys: readonly (readonly [string, string])[] = [
    ["Enter", "send"],
    ["\\ Enter, Ctrl+J, Alt+Enter", "new line"],
    ["↑ ↓", "earlier messages"],
    ["Esc", "stop the agent; twice, clear the message"],
    ["Ctrl+C", "clear the message; on an empty one, leave"],
    ["Shift+Tab, Ctrl+T", "plan or agent mode"],
    ["Ctrl+O", "expand tool calls and thinking"],
  ];
  const width = Math.max(...[...keys, ...commands].map(([name]) => name.length));
  return (
    <Box flexDirection="column" paddingLeft={2} marginBottom={1}>
      {[...keys, ...commands].map(([name, what]) => (
        <Text key={name}>
          {name.padEnd(width + 2)}
          <Text dimColor>{what}</Text>
        </Text>
      ))}
    </Box>
  );
}
