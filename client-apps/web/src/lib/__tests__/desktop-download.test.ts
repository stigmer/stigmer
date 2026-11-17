// ---------------------------------------------------------------------------
// desktop-download — the right installer, or an honest way to the page
//
// "Download desktop" resolves the installer from the latest GitHub release
// at click time. Three decisions are pinned here: which OS and architecture
// the browser is on (userAgentData's architecture on a Mac when Chromium
// offers it, arm64 otherwise); which release asset serves that platform (the
// universal .dmg serves any Mac, Linux prefers .deb); and what the visitor
// sees when any step fails — a toast naming the failure with a link to the
// download page, never a silent no-op or a forced redirect.
//
// Before the banner offers a download at all, it asks whether the latest
// release has an installer for this platform (stigmer#3194). That answer is
// remembered in this browser for a day, so a fresh page load within the day
// asks GitHub nothing and one after it asks again; a browser whose storage
// is blocked still gets an answer, remembered for that page load.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { DesktopAsset, DetectedPlatform } from "../desktop-download";

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  warning: vi.fn(),
}));
vi.mock("sonner", () => ({ toast }));

const DOWNLOADED_KEY = "stigmer:desktop-downloaded";
const INSTALLER_KEY = "stigmer:desktop-installer";

const UA = {
  macChrome:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36",
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  windows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36",
  linux:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36",
  chromeOS:
    "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36",
};

function setUserAgent(
  ua: string,
  uaData?: { getHighEntropyValues: () => Promise<{ architecture?: string }> },
) {
  Object.defineProperty(navigator, "userAgent", {
    value: ua,
    configurable: true,
  });
  Object.defineProperty(navigator, "userAgentData", {
    value: uaData
      ? { brands: [], mobile: false, platform: "macOS", ...uaData }
      : undefined,
    configurable: true,
  });
}

// The module caches the release it fetched; each test takes a fresh copy.
async function load() {
  vi.resetModules();
  return import("../desktop-download");
}

const asset = (
  os: DesktopAsset["os"],
  arch: DesktopAsset["arch"],
  filename: string,
): DesktopAsset => ({
  os,
  arch,
  filename,
  url: `https://dl.example/${filename}`,
  label: filename,
});

const RELEASE = {
  tag_name: "v1.4.2",
  assets: [
    {
      name: "Stigmer_1.4.2_universal.dmg",
      browser_download_url: "https://dl.example/Stigmer.dmg",
    },
    {
      name: "Stigmer_1.4.2_x64-setup.exe",
      browser_download_url: "https://dl.example/Stigmer-setup.exe",
    },
    {
      name: "stigmer_1.4.2_amd64.AppImage",
      browser_download_url: "https://dl.example/stigmer.AppImage",
    },
    {
      name: "stigmer_1.4.2_amd64.deb",
      browser_download_url: "https://dl.example/stigmer.deb",
    },
    {
      name: "latest.json",
      browser_download_url: "https://dl.example/latest.json",
    },
    {
      name: "Stigmer_1.4.2_universal.dmg.sig",
      browser_download_url: "https://dl.example/Stigmer.dmg.sig",
    },
  ],
};

function stubRelease(answer: () => Promise<Response>) {
  const fetchStub = vi.fn(answer);
  vi.stubGlobal("fetch", fetchStub);
  return fetchStub;
}

const releaseAnswer =
  (body: unknown, status = 200) =>
  async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

describe("detectPlatform", () => {
  afterEach(() => setUserAgent(UA.macSafari));

  it("reads a Mac's architecture from userAgentData when Chromium offers it", async () => {
    const { detectPlatform } = await load();
    setUserAgent(UA.macChrome, {
      getHighEntropyValues: async () => ({ architecture: "arm" }),
    });
    expect(await detectPlatform()).toEqual({ os: "macos", arch: "arm64" });

    setUserAgent(UA.macChrome, {
      getHighEntropyValues: async () => ({ architecture: "x86" }),
    });
    expect(await detectPlatform()).toEqual({ os: "macos", arch: "x64" });
  });

  it("falls back to arm64 on a Mac when userAgentData is absent or refuses", async () => {
    const { detectPlatform } = await load();
    setUserAgent(UA.macSafari);
    expect(await detectPlatform()).toEqual({ os: "macos", arch: "arm64" });

    setUserAgent(UA.macChrome, {
      getHighEntropyValues: () => Promise.reject(new Error("denied")),
    });
    expect(await detectPlatform()).toEqual({ os: "macos", arch: "arm64" });
  });

  it.each([
    ["Windows", UA.windows, { os: "windows", arch: "x64" }],
    ["Linux", UA.linux, { os: "linux", arch: "x64" }],
    ["ChromeOS", UA.chromeOS, { os: null, arch: null }],
  ])("detects %s", async (_label, ua, expected) => {
    const { detectPlatform } = await load();
    setUserAgent(ua);
    expect(await detectPlatform()).toEqual(expected);
  });
});

describe("findAssetForPlatform", () => {
  const assets = [
    asset("macos", null, "Stigmer.dmg"),
    asset("windows", "x64", "Stigmer-setup.exe"),
    asset("linux", "x64", "stigmer.AppImage"),
    asset("linux", "x64", "stigmer.deb"),
  ];

  it.each<[DetectedPlatform, string | null]>([
    [{ os: "macos", arch: "arm64" }, "Stigmer.dmg"],
    [{ os: "macos", arch: "x64" }, "Stigmer.dmg"],
    [{ os: "windows", arch: "x64" }, "Stigmer-setup.exe"],
    [{ os: "linux", arch: "x64" }, "stigmer.deb"],
    [{ os: "windows", arch: "arm64" }, null],
    [{ os: null, arch: null }, null],
  ])("serves %o with %s", async (platform, expected) => {
    const { findAssetForPlatform } = await load();
    expect(findAssetForPlatform(assets, platform)?.filename ?? null).toBe(
      expected,
    );
  });

  it("falls back to the AppImage on Linux when the release has no .deb", async () => {
    const { findAssetForPlatform } = await load();
    const noDeb = assets.filter((a) => !a.filename.endsWith(".deb"));
    expect(
      findAssetForPlatform(noDeb, { os: "linux", arch: "x64" })?.filename,
    ).toBe("stigmer.AppImage");
  });
});

describe("fetchLatestDesktopRelease", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("classifies the installers by extension, drops everything else, and strips the tag's v", async () => {
    const { fetchLatestDesktopRelease } = await load();
    stubRelease(releaseAnswer(RELEASE));

    const result = await fetchLatestDesktopRelease();
    if (!result.ok)
      throw new Error(`expected a release, got ${JSON.stringify(result)}`);
    expect(result.release.version).toBe("1.4.2");
    expect(
      result.release.assets.map((a) => [a.os, a.arch, a.filename]),
    ).toEqual([
      ["macos", null, "Stigmer_1.4.2_universal.dmg"],
      ["windows", "x64", "Stigmer_1.4.2_x64-setup.exe"],
      ["linux", "x64", "stigmer_1.4.2_amd64.AppImage"],
      ["linux", "x64", "stigmer_1.4.2_amd64.deb"],
    ]);
  });

  it("asks the API once and serves later calls from the cache", async () => {
    const { fetchLatestDesktopRelease } = await load();
    const fetchStub = stubRelease(releaseAnswer(RELEASE));

    await fetchLatestDesktopRelease();
    await fetchLatestDesktopRelease();
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      "an HTTP error",
      () => stubRelease(releaseAnswer({}, 403)),
      { ok: false, reason: "fetch-failed", status: 403 },
    ],
    [
      "a network error",
      () => stubRelease(() => Promise.reject(new TypeError("offline"))),
      { ok: false, reason: "fetch-failed" },
    ],
    [
      "a release with no installer",
      () =>
        stubRelease(
          releaseAnswer({
            tag_name: "v1",
            assets: [{ name: "notes.txt", browser_download_url: "x" }],
          }),
        ),
      { ok: false, reason: "no-assets" },
    ],
  ])(
    "reports %s as its own failure, and does not cache it",
    async (_label, arrange, expected) => {
      const { fetchLatestDesktopRelease } = await load();
      const fetchStub = arrange();

      expect(await fetchLatestDesktopRelease()).toEqual(expected);
      await fetchLatestDesktopRelease();
      expect(fetchStub).toHaveBeenCalledTimes(2);
    },
  );
});

describe("hasDesktopInstaller", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const T0 = Date.parse("2026-11-17T09:00:00.000Z");
  let now = T0;

  beforeEach(() => {
    localStorage.clear();
    now = T0;
    vi.spyOn(Date, "now").mockImplementation(() => now);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    setUserAgent(UA.macSafari);
  });

  it("answers yes for a platform the release serves, and remembers it", async () => {
    const { hasDesktopInstaller } = await load();
    setUserAgent(UA.windows);
    stubRelease(releaseAnswer(RELEASE));

    expect(await hasDesktopInstaller()).toBe(true);
    expect(JSON.parse(localStorage.getItem(INSTALLER_KEY) ?? "null")).toEqual({
      installer: true,
      checkedAt: T0,
    });
  });

  it.each([
    [
      "a release with no installer for the platform",
      UA.linux,
      releaseAnswer({ tag_name: "v1", assets: [RELEASE.assets[0]] }),
    ],
    [
      "a release with no installer at all",
      UA.macSafari,
      releaseAnswer({ tag_name: "v1", assets: [] }),
    ],
    ["an unknown platform", UA.chromeOS, releaseAnswer(RELEASE)],
    ["an unreachable release API", UA.windows, releaseAnswer({}, 403)],
  ])("answers no for %s, and remembers it", async (_label, ua, answer) => {
    const { hasDesktopInstaller } = await load();
    setUserAgent(ua);
    stubRelease(answer);

    expect(await hasDesktopInstaller()).toBe(false);
    expect(JSON.parse(localStorage.getItem(INSTALLER_KEY) ?? "null")).toEqual({
      installer: false,
      checkedAt: T0,
    });
  });

  it("reuses the remembered answer on a later page load within the day, and asks again after it", async () => {
    setUserAgent(UA.windows);
    const fetchStub = stubRelease(releaseAnswer(RELEASE));

    expect(await (await load()).hasDesktopInstaller()).toBe(true);
    expect(fetchStub).toHaveBeenCalledTimes(1);

    now = T0 + DAY - 1;
    expect(await (await load()).hasDesktopInstaller()).toBe(true);
    expect(fetchStub).toHaveBeenCalledTimes(1);

    now = T0 + DAY;
    expect(await (await load()).hasDesktopInstaller()).toBe(true);
    expect(fetchStub).toHaveBeenCalledTimes(2);
  });

  it("asks once for callers that ask together", async () => {
    const { hasDesktopInstaller } = await load();
    setUserAgent(UA.windows);
    const fetchStub = stubRelease(releaseAnswer(RELEASE));

    expect(
      await Promise.all([hasDesktopInstaller(), hasDesktopInstaller()]),
    ).toEqual([true, true]);
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it.each([
    "{not json",
    "42",
    "null",
    JSON.stringify({ installer: "yes", checkedAt: 1 }),
  ])(
    "ignores a remembered value that is not an answer (%s)",
    async (stored) => {
      localStorage.setItem(INSTALLER_KEY, stored);
      const { hasDesktopInstaller } = await load();
      setUserAgent(UA.windows);
      const fetchStub = stubRelease(releaseAnswer(RELEASE));

      expect(await hasDesktopInstaller()).toBe(true);
      expect(fetchStub).toHaveBeenCalledTimes(1);
    },
  );

  it("still answers when storage is blocked, remembering it for the page load", async () => {
    const refuse = () => {
      throw new DOMException("storage is blocked", "SecurityError");
    };
    vi.stubGlobal("localStorage", {
      getItem: refuse,
      setItem: refuse,
      removeItem: refuse,
      clear: refuse,
      key: refuse,
      length: 0,
    });
    const { hasDesktopInstaller } = await load();
    setUserAgent(UA.windows);
    const fetchStub = stubRelease(
      releaseAnswer({ tag_name: "v1", assets: [] }),
    );

    expect(await hasDesktopInstaller()).toBe(false);
    expect(await hasDesktopInstaller()).toBe(false);
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });
});

describe("triggerDesktopDownload", () => {
  let clicked: { href: string; download: string }[] = [];

  beforeEach(() => {
    toast.success.mockReset();
    toast.warning.mockReset();
    localStorage.clear();
    clicked = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push({ href: this.href, download: this.download });
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    setUserAgent(UA.macSafari);
  });

  it("downloads the platform's installer, marks the download, and says how to install", async () => {
    const { triggerDesktopDownload } = await load();
    setUserAgent(UA.windows);
    stubRelease(releaseAnswer(RELEASE));

    await triggerDesktopDownload();

    expect(clicked).toEqual([
      {
        href: "https://dl.example/Stigmer-setup.exe",
        download: "Stigmer_1.4.2_x64-setup.exe",
      },
    ]);
    expect(localStorage.getItem(DOWNLOADED_KEY)).not.toBeNull();
    expect(toast.success).toHaveBeenCalledWith(
      "Downloading Stigmer Desktop for Windows (64-bit)",
      expect.objectContaining({
        description: "Run the installer and follow the prompts.",
      }),
    );
    expect(toast.warning).not.toHaveBeenCalled();
    // The anchor is removed once clicked.
    expect(document.querySelectorAll("a[download]")).toHaveLength(0);
  });

  it.each([
    [
      "an unknown platform",
      UA.chromeOS,
      releaseAnswer(RELEASE),
      "Couldn’t detect your platform.",
    ],
    [
      "an unreachable release API",
      UA.windows,
      releaseAnswer({}, 500),
      "Couldn’t reach the download server.",
    ],
    [
      "no installer for the platform",
      UA.linux,
      releaseAnswer({ tag_name: "v1", assets: [RELEASE.assets[0]] }),
      "No installer found for Linux.",
    ],
  ])(
    "on %s downloads nothing and links to the download page",
    async (_label, ua, answer, message) => {
      const { triggerDesktopDownload } = await load();
      setUserAgent(ua);
      stubRelease(answer);
      const open = vi.spyOn(window, "open").mockImplementation(() => null);

      await triggerDesktopDownload();

      expect(clicked).toEqual([]);
      expect(localStorage.getItem(DOWNLOADED_KEY)).toBeNull();
      expect(toast.success).not.toHaveBeenCalled();
      expect(toast.warning).toHaveBeenCalledWith(message, expect.anything());

      const options = toast.warning.mock.calls[0]?.[1] as {
        action: { label: string; onClick: () => void };
      };
      expect(options.action.label).toBe("Download page");
      options.action.onClick();
      expect(open).toHaveBeenCalledWith(
        "https://stigmer.ai/download",
        "_blank",
        "noopener,noreferrer",
      );
    },
  );
});
