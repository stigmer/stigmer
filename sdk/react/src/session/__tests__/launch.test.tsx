/**
 * Pins the launches the agent page's "Make it yours" tab sends into the
 * launcher. `exampleLaunch`: on the sample, the example's files and first
 * message under "Run it on the sample"; on the person's own file, no files,
 * the example's message for a file of their own and the attach invited; an
 * agent described in their own words has no sample, so its launch is always
 * on their own file, with no message. `useLinkedLaunch`: each arrival of
 * `?with=` with a well-formed `?agent=` is a new launch with a new key (the
 * same link twice is two launches, since the host cleans its address in
 * between), the last launch is kept while the parameters are absent, and a
 * malformed or missing agent, or an unknown mode, is no launch.
 */
import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { exampleById } from "@stigmer/examples";
import { exampleLaunch, useLinkedLaunch, type LaunchParams } from "../launch";

const REPORT = exampleById("variance-report")!;
const AGENT = { org: "acme", slug: "variance-reporter" };

describe("exampleLaunch", () => {
  it("runs on the sample with its files and first message", async () => {
    const launch = exampleLaunch({ key: "k", agentRef: AGENT, example: REPORT, mode: "sample" });

    expect(launch).toMatchObject({ key: "k", agentRef: AGENT, message: REPORT.message, heading: "Run it on the sample" });
    expect(launch.files?.map((file) => file.name)).toEqual(["ledger.csv"]);
    expect(await launch.files?.[0]?.text()).toBe(REPORT.samples[0]?.text);
  });

  it("runs on the person's own file with the message for it, no files, and the attach invited", () => {
    const launch = exampleLaunch({ key: "k", agentRef: AGENT, example: REPORT, mode: "own" });

    expect(launch).toEqual({
      key: "k",
      agentRef: AGENT,
      message: "Here is one of our ledgers. Write the variance report.",
      heading: "Try it on your own file",
      placeholder: "Attach your file, then send",
    });
  });

  it("runs an agent described in the person's own words on their own file, with no message", () => {
    const launch = exampleLaunch({ key: "k", agentRef: { org: "acme", slug: "your-agent" }, example: undefined, mode: "sample" });

    expect(launch.files).toBeUndefined();
    expect(launch.message).toBeUndefined();
    expect(launch.heading).toBe("Try it on your own file");
  });
});

describe("useLinkedLaunch", () => {
  const NONE: LaunchParams = { agent: null, example: null, with: null };
  const OWN: LaunchParams = { agent: "acme/variance-reporter", example: "variance-report", with: "own" };

  it("reads a launch from the link, and keeps it once the host cleans its address", () => {
    const { result, rerender } = renderHook((params: LaunchParams) => useLinkedLaunch(params), { initialProps: OWN });

    expect(result.current).toMatchObject({ agentRef: { org: "acme", slug: "variance-reporter" }, heading: "Try it on your own file" });
    const key = result.current?.key;

    rerender(NONE);
    expect(result.current?.key).toBe(key);
  });

  it("makes each arrival of the same link a new launch", () => {
    const { result, rerender } = renderHook((params: LaunchParams) => useLinkedLaunch(params), { initialProps: OWN });
    const first = result.current?.key;
    rerender(NONE);
    rerender(OWN);

    expect(result.current?.key).not.toBe(first);
  });

  it("makes a new launch when another link arrives without the address clearing in between", () => {
    const { result, rerender } = renderHook((params: LaunchParams) => useLinkedLaunch(params), { initialProps: OWN });
    const first = result.current?.key;
    rerender({ ...OWN, with: "sample" });

    expect(result.current?.key).not.toBe(first);
    expect(result.current?.files?.map((file) => file.name)).toEqual(["ledger.csv"]);
  });

  it("reads no launch without a mode, with an unknown one, or with a malformed agent", () => {
    for (const params of [
      NONE,
      { ...OWN, with: null },
      { ...OWN, with: "later" },
      { ...OWN, agent: "variance-reporter" },
      { ...OWN, agent: "acme/" },
    ]) {
      const { result, unmount } = renderHook(() => useLinkedLaunch(params));
      expect(result.current).toBeUndefined();
      unmount();
    }
  });
});
