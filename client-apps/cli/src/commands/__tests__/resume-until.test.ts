// Command-level contract for `stigmer resume --until` (CLI-11): the mode of
// ending reaches the resume orchestrator from every way a session is named:
// its id, the picker opened with no reference, and the picker opened with
// text; an `--until` the command does not know is refused before the backend
// is reached. The backend, the picker and the orchestrator are replaced at
// their module seams (the command imports them lazily).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../../config/index.js";
import { buildProgram } from "../../program.js";

const CONFIG: Config = {
  backend: {},
  backends: { cloud: { type: "cloud", token: "test-token" } },
  current_backend: "cloud",
};

const backend = vi.hoisted(() => ({ connectBackend: vi.fn() }));
vi.mock("../../backend.js", () => backend);

const session = vi.hoisted(() => ({ openSession: vi.fn() }));
vi.mock("../../resources/run/resume.js", () => session);

const picker = vi.hoisted(() => ({ pickSession: vi.fn() }));
vi.mock("../../resources/picker/ink.js", () => picker);

vi.mock("../../resources/picker/tty.js", () => ({ interactiveBrowseEnabled: () => true }));

const SESSION_ID = "ses_01abc123xyz456789012345678";

async function resume(...args: string[]): Promise<void> {
  await buildProgram().parseAsync(["--standalone", "resume", ...args], { from: "user" });
}

beforeEach(() => {
  backend.connectBackend.mockReturnValue({ config: CONFIG, stigmer: { name: "stub-client" } });
  picker.pickSession.mockResolvedValue({ metadata: { id: "ses_picked" } });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("CLI-11 stigmer resume takes how it ends from --until", () => {
  it("hands --until turn to the orchestrator for a session named by id, and exit by default", async () => {
    await resume(SESSION_ID, "--until", "turn");
    expect(session.openSession).toHaveBeenLastCalledWith(expect.objectContaining({ sessionId: SESSION_ID, until: "turn", outputMode: "inline" }));
    await resume(SESSION_ID, "-o", "json");
    expect(session.openSession).toHaveBeenLastCalledWith(expect.objectContaining({ until: "exit", outputMode: "json" }));
  });

  it("hands it on from the picker, opened with no reference or with text", async () => {
    await resume("--until", "turn");
    expect(picker.pickSession).toHaveBeenLastCalledWith(expect.objectContaining({ initialQuery: "" }));
    expect(session.openSession).toHaveBeenLastCalledWith(expect.objectContaining({ sessionId: "ses_picked", until: "turn" }));
    await resume("ledger review", "--until", "turn");
    expect(picker.pickSession).toHaveBeenLastCalledWith(expect.objectContaining({ initialQuery: "ledger review" }));
    expect(session.openSession).toHaveBeenCalledTimes(2);
  });

  it("refuses an --until it does not know before reaching the backend", async () => {
    await expect(resume(SESSION_ID, "--until", "done")).rejects.toMatchObject({ exitCode: 2 });
    expect(backend.connectBackend).not.toHaveBeenCalled();
  });
});
