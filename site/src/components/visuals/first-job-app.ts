/**
 * The first-job block's "Your app" tab, as data: the program the Getting
 * Started page runs, its three calls, what it prints, and the moments of the
 * drawing beside it, where Northwind Books sees what each call did.
 *
 * Every word the tab shows comes from a page the Getting Started smoke runs
 * or a recording the terminal kit holds, and `__tests__/first-job.test.tsx`
 * holds each to its source: `PROGRAM` to docs/getting-started/call-from-your-app.mdx's
 * `variance-report.ts` as `docSteps` reads it, `COMMAND` to that page's run
 * step and `PRINTS` to its output block, `REPORT` to the quickstart's sample
 * report, and `WORKED_SECONDS` to the `first-job` recording's last frame
 * ("Worked for 38s"), so the clock here stops where the terminal's does.
 *
 * Data only, with relative imports: the markdown export reads `CAPTION`
 * (src/lib/llms-pages.ts), and the job's names are brand/job-story.ts's.
 */
import { JOB } from "../../../../brand/job-story";

/** docs/getting-started/call-from-your-app.mdx's `variance-report.ts`, line for line. */
export const PROGRAM: readonly string[] = [
  'import { mkdir, writeFile } from "node:fs/promises";',
  'import { dirname, join } from "node:path";',
  'import { sendAndWait } from "@stigmer/client";',
  'import { uploadFileFromPath } from "@stigmer/client/node";',
  'import { org, stigmer } from "./client.js";',
  "",
  "const ledger = await uploadFileFromPath(stigmer.file, {",
  "  org,",
  '  path: "ledger.csv",',
  "});",
  "",
  "const turn = await sendAndWait(stigmer, {",
  "  org,",
  '  sessionSpec: { agentRef: { org, slug: "variance-reporter" } },',
  "  message: \"Review this quarter's ledger.\",",
  "  fileIds: [ledger.metadata!.id],",
  "});",
  'if (turn.phase !== "completed") {',
  "  throw new Error(`The job ended ${turn.phase}: ${turn.error}`);",
  "}",
  "",
  "for await (const file of stigmer.file.listAll({ org, runId: turn.runId })) {",
  '  const path = join("out", file.status!.outputPath);',
  "  const { url } = await stigmer.file.getDownloadUrl(file.metadata!.id);",
  "  const response = await fetch(url);",
  "  await mkdir(dirname(path), { recursive: true });",
  "  await writeFile(path, Buffer.from(await response.arrayBuffer()));",
  "  console.log(`Saved ${path}`);",
  "}",
];

/** The file the program is saved as on that page. */
export const PROGRAM_FILE = "variance-report.ts";

/** One of the program's three calls: the lines it spans in `PROGRAM` (0-based, inclusive) and the name it opens with. */
export interface Call {
  readonly from: number;
  readonly to: number;
  readonly opens: string;
}

/** The upload, the job, and the files back, in the order the program makes them. */
export const CALLS: readonly [Call, Call, Call] = [
  { from: 6, to: 9, opens: "uploadFileFromPath" },
  { from: 11, to: 19, opens: "sendAndWait" },
  { from: 21, to: 28, opens: "stigmer.file.listAll" },
];

/** The command that page runs the program with. */
export const COMMAND = "npx tsx variance-report.ts";

/** What the program prints, as that page shows it. */
export const PRINTS = "Saved out/variance-report.md";

/** One account of the report: the columns the drawing shows. */
export interface ReportRow {
  readonly account: string;
  readonly variance: string;
  readonly percent: string;
  readonly flag: "" | "Over" | "Under";
}

/** The quickstart's sample report's title. */
export const REPORT_TITLE = "Q3 variance report";

/** The quickstart's sample report, flagged accounts first, as it lists them. */
export const REPORT: readonly ReportRow[] = [
  { account: "Marketing", variance: "+5,100", percent: "+56.7%", flag: "Over" },
  { account: "Travel", variance: "-1,800", percent: "-60.0%", flag: "Under" },
  { account: "Cost of goods sold", variance: "+7,200", percent: "+15.0%", flag: "Over" },
  { account: "Revenue", variance: "+11,500", percent: "+9.6%", flag: "" },
  { account: "Salaries", variance: "+400", percent: "+1.1%", flag: "" },
  { account: "Software", variance: "-100", percent: "-2.5%", flag: "" },
];

/** How long the Agent worked, as the terminal's last frame says it. */
export const WORKED_SECONDS = 38;

/** Where the ledger stands in Northwind Books' window. */
export type Upload = "ready" | "uploading" | "uploaded";

/** One moment of the tab: when it shows, which call is lit (0 for none), and what Northwind Books sees. */
export interface AppMoment {
  readonly at: number;
  readonly call: 0 | 1 | 2 | 3;
  readonly upload: Upload;
  /** The Agent's clock in seconds, or null before the job starts. */
  readonly seconds: number | null;
  /** The report's rows shown, or null before it comes back. */
  readonly rows: number | null;
  /** Whether the program has printed `PRINTS`. */
  readonly printed: boolean;
}

/** When each change happens, in milliseconds from the start: the clock plays 38 s in about 3 s. */
const TIMING = {
  upload: 700,
  uploaded: 1_700,
  job: 2_300,
  tick: 85,
  report: 6_100,
  firstRow: 250,
  row: 140,
  printed: 7_000,
  rest: 8_600,
} as const;

/** The moments, in order: each change laid over the moment before it. */
function moments(): AppMoment[] {
  const changes: { at: number; change: Partial<AppMoment> }[] = [
    { at: TIMING.upload, change: { call: 1, upload: "uploading" } },
    { at: TIMING.uploaded, change: { upload: "uploaded" } },
    { at: TIMING.job, change: { call: 2, seconds: 0 } },
    ...Array.from({ length: WORKED_SECONDS }, (_, i) => ({ at: TIMING.job + (i + 1) * TIMING.tick, change: { seconds: i + 1 } })),
    { at: TIMING.report, change: { call: 3, rows: 0 } },
    ...REPORT.map((_, i) => ({ at: TIMING.report + TIMING.firstRow + i * TIMING.row, change: { rows: i + 1 } })),
    { at: TIMING.printed, change: { printed: true } },
    { at: TIMING.rest, change: { call: 0 } },
  ];
  const out: AppMoment[] = [{ at: 0, call: 0, upload: "ready", seconds: null, rows: null, printed: false }];
  for (const { at, change } of changes.sort((a, b) => a.at - b.at)) {
    out.push({ ...out.at(-1)!, ...change, at });
  }
  return out;
}

/** Every moment of the tab; the last is the whole job done, which a reader who asked for less motion sees. */
export const MOMENTS: readonly AppMoment[] = moments();

/** The tab in words: what a reader who cannot see the drawing, and the markdown exports, get. */
export const CAPTION =
  `${PROGRAM_FILE} does the job in three calls, and beside it ${JOB.customer} sees what each one did. ` +
  `${CALLS[0].opens} uploads ${JOB.ledger}. ` +
  `${CALLS[1].opens} starts the job on ${JOB.agent}, which works for ${WORKED_SECONDS}s. ` +
  `${CALLS[2].opens} brings back ${JOB.report}, the ${REPORT_TITLE}, flagged accounts first: ` +
  `${REPORT.filter((row) => row.flag !== "")
    .map((row) => `${row.account} ${row.percent} (${row.flag.toLowerCase()})`)
    .join(", ")}. ` +
  `The program prints "${PRINTS}".`;
