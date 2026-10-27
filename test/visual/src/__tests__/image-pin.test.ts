// The browser image every screenshot is drawn in (../../playwright-image.json)
// is pinned once and held here: the CI job that compares the screenshots runs
// in exactly that image on a runner of its architecture, and the Playwright
// that drives it is the version the image was built for. A digest bump is a
// deliberate change, made in the pin, that re-mints every screenshot in one
// reviewed diff; this check is what makes the job and the pin move together.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const repo = (path: string) => fileURLToPath(new URL(`../../../../${path}`, import.meta.url));
const read = (path: string) => readFileSync(repo(path), "utf8");

interface Pin {
  readonly image: string;
  readonly platform: string;
}

interface Job {
  readonly "runs-on"?: string;
  readonly container?: { readonly image?: string } | string;
}

const pin = JSON.parse(read("test/visual/playwright-image.json")) as Pin;
const workflow = parse(read(".github/workflows/ci.ts-workspace.yaml")) as { readonly jobs: Readonly<Record<string, Job>> };
const lock = JSON.parse(read("package-lock.json")) as { readonly packages: Readonly<Record<string, { readonly version?: string }>> };
const manifest = JSON.parse(read("test/visual/package.json")) as { readonly devDependencies: Readonly<Record<string, string>> };

/** The runner label GitHub gives each architecture the pin may name. */
const RUNNER_OF_PLATFORM: Readonly<Record<string, string>> = {
  "linux/arm64": "ubuntu-24.04-arm",
  "linux/amd64": "ubuntu-24.04",
};

describe("the browser image pin", () => {
  it("names the official Playwright image by tag and digest", () => {
    expect(pin.image).toMatch(/^mcr\.microsoft\.com\/playwright:v\d+\.\d+\.\d+-[a-z]+@sha256:[0-9a-f]{64}$/);
  });

  it("is the image the visual job runs in, on a runner of the pinned architecture", () => {
    const job = workflow.jobs.visual;
    expect(job, "ci.ts-workspace.yaml has a `visual` job").toBeDefined();
    const image = typeof job?.container === "string" ? job.container : job?.container?.image;
    expect(image).toBe(pin.image);
    expect(job?.["runs-on"]).toBe(RUNNER_OF_PLATFORM[pin.platform]);
  });

  it("was built for the Playwright the lockfile pins and the package declares", () => {
    const version = /playwright:v(\d+\.\d+\.\d+)-/.exec(pin.image)?.[1];
    expect(lock.packages["node_modules/@playwright/test"]?.version).toBe(version);
    expect(lock.packages["node_modules/playwright-core"]?.version).toBe(version);
    expect(manifest.devDependencies["@playwright/test"]).toBe(version);
  });
});
