// Pins stigmer-ink's command line: starting with an agent (org/slug, or a
// slug with --org), sending into or watching a session, the key and server
// from the environment, `until` defaulting by whether a message is sent, and
// one usage error per mistake (exit 2 in the bin).
import { describe, expect, it } from "vitest";
import { DEFAULT_BASE_URL, parseCliArgs } from "../cli/args.js";

const run = (argv: string[], env: Record<string, string> = {}) => parseCliArgs(argv, env);

describe("parseCliArgs", () => {
  it("starts a conversation with an agent", () => {
    expect(run(["--agent", "acme/reviewer", "--message", "Review this diff"], { STIGMER_API_KEY: "k" })).toEqual({
      kind: "run",
      baseUrl: DEFAULT_BASE_URL,
      apiKey: "k",
      org: "acme",
      agent: { org: "acme", slug: "reviewer" },
      sessionId: undefined,
      message: "Review this diff",
      until: "turn",
      approveDefault: "deny",
      mode: undefined,
    });
  });

  it("takes a bare slug with --org, short flags, and the server from the environment", () => {
    expect(run(["-a", "reviewer", "-o", "acme", "-m", "hi", "-M", "plan"], { STIGMER_BASE_URL: "http://srv" })).toMatchObject({
      org: "acme",
      agent: { org: "acme", slug: "reviewer" },
      baseUrl: "http://srv",
      mode: "plan",
    });
    expect(run(["-a", "acme/r", "-m", "hi", "-u", "http://flag", "-k", "argkey"], { STIGMER_BASE_URL: "http://env", STIGMER_API_KEY: "envkey" })).toMatchObject({
      baseUrl: "http://flag",
      apiKey: "argkey",
    });
  });

  it("sends into a session until the turn ends, or watches one until the person quits", () => {
    expect(run(["--session", "ses_1", "--org", "acme", "--message", "go on"])).toMatchObject({ sessionId: "ses_1", until: "turn", agent: undefined });
    expect(run(["--session", "ses_1", "--org", "acme"])).toMatchObject({ message: undefined, until: "exit" });
    expect(run(["--session", "ses_1", "--org", "acme", "-m", "x", "--until", "exit", "--approve-default", "approve"])).toMatchObject({
      until: "exit",
      approveDefault: "approve",
    });
  });

  it("asks for help", () => {
    expect(run(["--help"])).toEqual({ kind: "help" });
    expect(run(["-h", "--agent", "x"])).toEqual({ kind: "help" });
  });

  it.each([
    [[], "name an agent"],
    [["--agent", "a/b", "--session", "s", "-m", "x"], "pass one of them"],
    [["--agent", "acme", "-m", "x"], "--agent takes org/slug"],
    [["--agent", "a/b/c", "-m", "x"], "--agent takes org/slug"],
    [["--agent", "/b", "-m", "x"], "--agent takes org/slug"],
    [["--agent", "a/b"], "--agent needs --message"],
    [["--agent", "a/b", "-m", ""], "--agent needs --message"],
    [["--session", "s", "--org", ""], "--session needs --org"],
    [["--session", "s"], "--session needs --org"],
    [["--agent", "a/b", "-m", "x", "--until", "later"], '--until must be turn or exit, not "later"'],
    [["--agent", "a/b", "-m", "x", "--approve-default", "maybe"], "--approve-default must be approve or deny"],
    [["--agent", "a/b", "-m", "x", "--mode", "fast"], "--mode must be agent or plan"],
    [["--agent", "a/b", "-m", "x", "extra"], 'unexpected argument "extra"'],
    [["--frobnicate"], "Unknown option"],
  ])("refuses %j", (argv, message) => {
    const request = run(argv);
    expect(request.kind).toBe("usage-error");
    expect(request.kind === "usage-error" ? request.message : "").toContain(message);
  });
});
