// Command-level contract for `stigmer channel`: `link` turns its flags into
// the resource layer's options (audience, --off, --reset-link, --name), refuses
// the combinations that make no sense before any call, renders the result,
// and opens the chat link only when asked and only while the link is on;
// `enable` and `disable` hand the resource layer the switch's new state. The
// backend, the channel resource and the browser launcher are replaced at their
// module seams; the program and the flag parsing are real.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../../config/index.js";
import { CommandResult, Section } from "../../output/command-result.js";
import { buildProgram } from "../../program.js";

const CONFIG: Config = {
  backend: {},
  backends: { cloud: { type: "cloud", token: "test-token" } },
  current_backend: "cloud",
};

const stigmer = vi.hoisted(() => ({ name: "stub-client" }));

vi.mock("../../backend.js", () => ({
  connectBackend: () => ({ config: CONFIG, stigmer }),
}));

const channel = vi.hoisted(() => ({
  linkAgent: vi.fn(),
  setChannelEnabled: vi.fn(),
}));
vi.mock("../../resources/channel.js", () => channel);

const opener = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("open", () => ({ default: opener.open }));

const LINK = "https://app.stigmer.ai/chat/chn_1?k=tok";

/** The result `linkAgent` answers: the chat link in its own section. */
function linkResult(): CommandResult {
  const result = CommandResult.success("Chat link on");
  result.sections.push(new Section("Public chat link").item(LINK));
  return result;
}

let stdout: string[];
let stderr: string[];

/** Runs `stigmer ...`, returning what it wrote to stdout. */
async function run(...args: string[]): Promise<string> {
  const program = buildProgram();
  program.exitOverride();
  await program.parseAsync(["node", "stigmer", "--standalone", ...args]);
  return stdout.join("");
}

beforeEach(() => {
  stdout = [];
  stderr = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  channel.linkAgent.mockReset();
  channel.setChannelEnabled.mockReset();
  opener.open.mockReset();
});

describe("stigmer channel link", () => {
  it("passes the audience, the name and the switch to the resource layer and renders its result", async () => {
    channel.linkAgent.mockResolvedValue(linkResult());
    const out = await run("--org", "acme", "channel", "link", "support", "--audience", "public", "--name", "support-site", "--json");
    const [client, ref, org, options] = channel.linkAgent.mock.calls[0] ?? [];
    expect(client).toBe(stigmer);
    expect([ref, org]).toEqual(["support", "acme"]);
    expect(options).toMatchObject({ enabled: true, audience: "public", name: "support-site", resetLink: false });
    expect(out).toContain(LINK);
  });

  it("turns the link off with --off and keeps the audience the link has", async () => {
    channel.linkAgent.mockResolvedValue(linkResult());
    await run("channel", "link", "acme/support", "--off");
    const options = channel.linkAgent.mock.calls[0]?.[3] as Record<string, unknown>;
    expect(options.enabled).toBe(false);
    expect("audience" in options).toBe(false);
    expect("name" in options).toBe(false);
  });

  it("refuses an audience other than public or org before any call", async () => {
    await expect(run("channel", "link", "acme/support", "--audience", "everyone")).rejects.toThrow(/invalid --audience 'everyone'/);
    expect(channel.linkAgent).not.toHaveBeenCalled();
  });

  it("refuses --reset-link with --off before any call", async () => {
    await expect(run("channel", "link", "acme/support", "--off", "--reset-link")).rejects.toThrow(/--reset-link cannot be combined with --off/);
    expect(channel.linkAgent).not.toHaveBeenCalled();
  });

  it("refuses an empty --name before any call", async () => {
    await expect(run("channel", "link", "acme/support", "--name", "")).rejects.toThrow(/--name needs a slug/);
    expect(channel.linkAgent).not.toHaveBeenCalled();
  });

  it("opens the chat link in the browser with --open", async () => {
    channel.linkAgent.mockResolvedValue(linkResult());
    opener.open.mockResolvedValue(undefined);
    await run("channel", "link", "acme/support", "--open");
    expect(opener.open).toHaveBeenCalledWith(LINK);
  });

  it("only nudges when the browser cannot be opened: the link is already on screen", async () => {
    channel.linkAgent.mockResolvedValue(linkResult());
    opener.open.mockRejectedValue(new Error("no browser"));
    await run("channel", "link", "acme/support", "--open");
    expect(stderr.join("")).toContain("Could not open the browser automatically");
  });

  it("opens nothing when --open turns the link off", async () => {
    channel.linkAgent.mockResolvedValue(linkResult());
    await run("channel", "link", "acme/support", "--open", "--off");
    expect(opener.open).not.toHaveBeenCalled();
  });
});

describe("stigmer channel enable and disable", () => {
  it.each([
    ["enable", true],
    ["disable", false],
  ] as const)("%s hands the resource layer the switch's new state", async (verb, enabled) => {
    channel.setChannelEnabled.mockResolvedValue(CommandResult.success(`Channel ${verb}d`));
    const out = await run("--org", "acme", "channel", verb, "support-slack", "--json");
    expect(channel.setChannelEnabled).toHaveBeenCalledWith(stigmer, "support-slack", "acme", enabled);
    expect(out).toContain(`Channel ${verb}d`);
  });
});
