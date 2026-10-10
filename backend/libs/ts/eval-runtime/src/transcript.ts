/**
 * The plugin-eval format's transcripts: a Claude Code session saved as
 * `.jsonl`, one record per line, read as the conversation a model saw.
 *
 * One reader for every use of the format's transcripts. The suite reader
 * checks a case's `history_file` with it at push; the runner turns the same
 * messages into a resumed try's first input; the `baseline` grader renders
 * a reference transcript from it as text for the judge. Kept here so a
 * history the server accepted is the history the runner resumes.
 *
 * What a record is. Claude Code writes `{"type": "user" | "assistant",
 * "message": {"role", "content"}}` per record, beside records of other
 * types (`summary`, `system`, file snapshots) and sidechain records a
 * sub-agent wrote (`isSidechain: true`). Only the main conversation's user
 * and assistant records are a conversation; the rest are dropped. An
 * assistant reply is often split over several records, one per content
 * block, and tool results arrive one per record, so consecutive records of
 * one role are joined into one message, which is also what a model API
 * requires.
 *
 * What a block is. `text`, `tool_use` and `tool_result` are kept; a call
 * or result missing its id is kept with an empty one, which a rendering
 * shows and the pairing rule refuses.
 * `thinking` and `redacted_thinking` are dropped: a thinking block carries
 * a signature that binds it to the turn that produced it, and a resumed
 * conversation is a new turn. An image becomes the words "[image]", since
 * nothing here carries media.
 *
 * The pairing rule, checked only when asked ({@link parseTranscript}'s
 * `requirePairing`): every `tool_use` is answered by a `tool_result` in the
 * user message right after it, and every `tool_result` answers a
 * `tool_use` of the assistant message right before it, as a model API
 * requires of a history it is sent. A rendering for a judge does not need
 * it and reads leniently.
 */

/** One content block of a transcript message. */
export type TranscriptBlock =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "tool_use";
      readonly id: string;
      readonly name: string;
      readonly input: Readonly<Record<string, unknown>>;
    }
  | {
      readonly type: "tool_result";
      readonly toolUseId: string;
      /** The result's text; non-text parts named in brackets. */
      readonly content: string;
      readonly isError: boolean;
    };

/** One message of a transcript, records of one role joined. */
export interface TranscriptMessage {
  readonly role: "user" | "assistant";
  readonly blocks: readonly TranscriptBlock[];
}

/** A parsed transcript, or why it cannot be resumed. */
export type TranscriptParse =
  | { readonly ok: true; readonly messages: readonly TranscriptMessage[] }
  | { readonly ok: false; readonly error: string };

/** How strictly {@link parseTranscript} reads. */
export interface TranscriptParseOptions {
  /** Refuse a transcript whose tool calls and results do not pair (the module header). */
  readonly requirePairing: boolean;
}

/**
 * Read a `.jsonl` transcript. A line that is not JSON is an error naming
 * its number; so is an empty conversation, and, under `requirePairing`, an
 * unpaired tool call or result.
 */
export function parseTranscript(text: string, options: TranscriptParseOptions): TranscriptParse {
  const messages: { role: "user" | "assistant"; blocks: TranscriptBlock[] }[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? "").trim();
    if (line === "") continue;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      return { ok: false, error: `line ${i + 1} is not JSON` };
    }
    const read = messageOf(record);
    if (read === undefined || read.blocks.length === 0) continue;
    const last = messages.at(-1);
    if (last !== undefined && last.role === read.role) {
      last.blocks.push(...read.blocks);
    } else {
      messages.push({ role: read.role, blocks: [...read.blocks] });
    }
  }
  if (messages.length === 0) {
    return { ok: false, error: "it holds no user or assistant message" };
  }
  if (options.requirePairing) {
    const unpaired = pairingError(messages);
    if (unpaired !== undefined) return { ok: false, error: unpaired };
  }
  return { ok: true, messages };
}

/**
 * A transcript as text for a judge, one message per line: "role: text",
 * with tool calls and results named in brackets. Records that are not the
 * conversation are dropped as {@link parseTranscript} drops them; a line
 * that is not JSON is kept where it stands, as written, so a judge still
 * reads what an author put there.
 */
export function renderTranscript(text: string): string {
  const out: string[] = [];
  let last: { role: "user" | "assistant"; parts: string[] } | undefined;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      if (last !== undefined) out.push(`${last.role}: ${last.parts.join(" ")}`);
      last = undefined;
      out.push(line);
      continue;
    }
    const read = messageOf(record);
    if (read === undefined || read.blocks.length === 0) continue;
    const parts = read.blocks.map(renderBlock);
    if (last !== undefined && last.role === read.role) {
      last.parts.push(...parts);
    } else {
      if (last !== undefined) out.push(`${last.role}: ${last.parts.join(" ")}`);
      last = { role: read.role, parts };
    }
  }
  if (last !== undefined) out.push(`${last.role}: ${last.parts.join(" ")}`);
  return out.join("\n");
}

function renderBlock(block: TranscriptBlock): string {
  switch (block.type) {
    case "text":
      return block.text;
    case "tool_use":
      return `[called ${block.name} ${JSON.stringify(block.input)}]`;
    case "tool_result":
      return `[tool result: ${block.content}]`;
  }
}

/** The main conversation's message a record carries, or `undefined` for any other record. */
function messageOf(
  record: unknown,
): { readonly role: "user" | "assistant"; readonly blocks: readonly TranscriptBlock[] } | undefined {
  if (!isRecord(record) || record["isSidechain"] === true) return undefined;
  const type = record["type"];
  if (type !== "user" && type !== "assistant") return undefined;
  const message = record["message"];
  if (!isRecord(message)) return undefined;
  const content = message["content"];
  if (typeof content === "string") {
    return content.trim() === "" ? undefined : { role: type, blocks: [{ type: "text", text: content }] };
  }
  if (!Array.isArray(content)) return undefined;
  return { role: type, blocks: content.flatMap(blockOf) };
}

function blockOf(block: unknown): TranscriptBlock[] {
  if (!isRecord(block)) return [];
  switch (block["type"]) {
    case "text":
      return typeof block["text"] === "string" && block["text"] !== ""
        ? [{ type: "text", text: block["text"] }]
        : [];
    case "tool_use": {
      const id = typeof block["id"] === "string" ? block["id"] : "";
      const name = block["name"];
      if (typeof name !== "string") return [];
      const input = isRecord(block["input"]) ? block["input"] : {};
      return [{ type: "tool_use", id, name, input }];
    }
    case "tool_result": {
      const toolUseId = typeof block["tool_use_id"] === "string" ? block["tool_use_id"] : "";
      return [
        {
          type: "tool_result",
          toolUseId,
          content: resultText(block["content"]),
          isError: block["is_error"] === true,
        },
      ];
    }
    case "image":
      return [{ type: "text", text: "[image]" }];
    default:
      return [];
  }
}

/** A tool result's content as text: a string as is, text parts joined, other parts named. */
function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part: unknown) => {
      if (!isRecord(part)) return "";
      if (part["type"] === "text" && typeof part["text"] === "string") return part["text"];
      return `[${typeof part["type"] === "string" ? part["type"] : "content"}]`;
    })
    .join("\n");
}

/** The first pairing violation (the module header), or `undefined`. */
function pairingError(messages: readonly TranscriptMessage[]): string | undefined {
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (message === undefined) continue;
    const before = messages[i - 1];
    const after = messages[i + 1];
    if (message.role === "assistant") {
      const answered = new Set(
        after?.blocks.flatMap((b) => (b.type === "tool_result" ? [b.toolUseId] : [])) ?? [],
      );
      for (const block of message.blocks) {
        if (block.type === "tool_use" && !answered.has(block.id)) {
          return `the call ${block.name} (${block.id}) has no tool_result in the next user message`;
        }
      }
      if (message.blocks.some((b) => b.type === "tool_result")) {
        return `an assistant message carries a tool_result`;
      }
    } else {
      const asked = new Set(
        before?.role === "assistant"
          ? before.blocks.flatMap((b) => (b.type === "tool_use" ? [b.id] : []))
          : [],
      );
      for (const block of message.blocks) {
        if (block.type === "tool_result" && !asked.has(block.toolUseId)) {
          return `the tool_result for ${block.toolUseId} answers no call of the assistant message before it`;
        }
      }
      if (message.blocks.some((b) => b.type === "tool_use")) {
        return `a user message carries a tool_use`;
      }
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
