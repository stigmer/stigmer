// The terminal recordings the docs play: the terminal kit's own frames,
// drawn over a story of the scenario catalogue one event at a time.
//
// An entry names the story it draws, the terminal's size, the command the
// first frame shows being typed, and what the recording shows.
// `src/__tests__/recordings.test.tsx` draws each one with `SessionView`, as
// the frame goldens draw a state, and holds the frames in
// `src/__tests__/__recordings__/<name>.json`; the docs site plays that file
// with `<TerminalRecording name>`.
//
// It imports nothing: the site reads this file into its own build and
// typecheck, where the kit's sources do not load.

/** One recording the docs may play. */
export interface Recording {
  /** The handle pages use (`<TerminalRecording name="run-approval">`) and the file's name. */
  readonly name: string;
  /** The catalogue's story it draws, event by event. */
  readonly story: "scripted-turn";
  /** The terminal's width, in columns. */
  readonly columns: number;
  /** The terminal's height, in rows: the player shows a frame's last this many lines. */
  readonly rows: number;
  /** The command the first frame shows typed at the prompt. */
  readonly command: string;
  /** What the recording shows, as a reader would say it. */
  readonly title: string;
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
