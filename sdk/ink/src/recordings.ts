// The terminal recordings the docs play: the terminal kit's own frames,
// drawn over a story of the scenario catalogue one event at a time.
//
// An entry names the story it draws, the terminal's size, the command the
// first frame shows being typed, what the recording shows, what its last
// frame says and whether it waits for the person, and, for a command that
// saves the turn's outputs, the notes the host writes in the thread when it
// does. `src/__tests__/recordings.test.tsx` draws each one with one live
// `SessionView`, as a terminal keeps one up through the turn, and holds the
// frames in `src/__tests__/__recordings__/<name>.json`; the docs site plays
// that file with `<TerminalRecording name>`. The CLI's own test holds each
// `afterTurn` to the lines `--download` writes
// (client-apps/cli/src/resources/run/__tests__/recorded-notes.test.ts).
//
// It imports nothing: the site reads this file into its own build and
// typecheck, where the kit's sources do not load.

/** One recording the docs may play. */
export interface Recording {
  /** The handle pages use (`<TerminalRecording name="run-approval">`) and the file's name. */
  readonly name: string;
  /** The catalogue's story it draws, event by event. */
  readonly story: "scripted-turn" | "ledger-turn";
  /** The terminal's width, in columns. */
  readonly columns: number;
  /** The terminal's height, in rows: the player shows a frame's last this many lines. */
  readonly rows: number;
  /** The command the first frame shows typed at the prompt. */
  readonly command: string;
  /** What the recording shows, as a reader would say it. */
  readonly title: string;
  /** Words the last frame shows: what the turn ends on. */
  readonly endsWith: string;
  /** Whether a frame waits for the person's answer to an ask, and holds there. */
  readonly asks: boolean;
  /** What the host does when the turn ends, for a command that saves its outputs; none when it saves nothing. */
  readonly afterTurn?: AfterTurn;
}

/** The turn's outputs a command saves when the turn ends, and the notes it writes in the thread as it does. */
export interface AfterTurn {
  /** Each File saved: its place in the outputs folder and its size in bytes. */
  readonly saved: readonly { readonly path: string; readonly bytes: number }[];
  /** The notes, in order, each drawn in a frame of its own. */
  readonly notes: readonly string[];
}

/** Every recording the docs may play. */
export const RECORDINGS: readonly Recording[] = [
  {
    name: "run-approval",
    story: "scripted-turn",
    columns: 80,
    rows: 24,
    command: 'stigmer run demo/demo-agent -m "What changed in billing this week?"',
    title: "stigmer run: the agent reads two files, asks before it runs git log, and answers once allowed",
    endsWith: "Two changes this week",
    asks: true,
  },
  {
    name: "first-job",
    story: "ledger-turn",
    columns: 80,
    rows: 16,
    command: 'stigmer run variance-reporter --attach ledger.csv --download ./out --until turn -m "Review this quarter\'s ledger."',
    title: "stigmer run: the Agent reads the customer's ledger, writes the variance report, names the flagged accounts, and the report is saved",
    endsWith: "Worked for 38s",
    asks: false,
    afterTurn: {
      saved: [{ path: "variance-report.md", bytes: 696 }],
      notes: ["Downloading variance-report.md (696 B)...", "Downloaded variance-report.md (696 B)"],
    },
  },
];

/** One frame of a recording: when it is drawn, in milliseconds from the start, and the terminal's text, escape codes kept. */
export interface RecordingFrame {
  readonly at: number;
  readonly text: string;
}

/** A recording as its file holds it. */
export interface RecordedSession extends Recording {
  readonly frames: readonly RecordingFrame[];
}
