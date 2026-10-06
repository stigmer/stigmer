// Unit arms for the vendored real plugins: every directory holds exactly the
// files upstream's tree lists at the vendored commit, each with upstream's
// git blob SHA and mode, so "unchanged" is proven offline; the blob hash is
// git's own; a rule comes from the plugin's examples at the path hookify reads.
// Reads the vendored fixtures from disk. No target.
// Domain: test support (fixtures).
import { statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  gitBlobSha,
  hookifyExampleRule,
  REAL_CLAUDE_PLUGINS,
  realPluginDir,
  realPluginFiles,
  upstreamManifest,
} from "../real-plugins.ts";

describe("vendored real plugins", () => {
  it("names the source commit the NOTICE names", () => {
    const manifest = upstreamManifest();
    expect(manifest.repository).toBe("https://github.com/anthropics/claude-plugins-official");
    expect(manifest.commit).toBe("d182ca456ca09d31d139f7d3818d1d333b103cce");
  });

  for (const name of REAL_CLAUDE_PLUGINS) {
    describe(name, () => {
      const upstream = upstreamManifest().plugins[name];
      const files = realPluginFiles(name);

      it("holds exactly upstream's files", () => {
        expect([...files.keys()].sort()).toEqual(Object.keys(upstream.files).sort());
      });

      it("holds every file byte for byte as upstream's blob", () => {
        const differing = [...files].filter(([path, bytes]) => gitBlobSha(bytes) !== upstream.files[path]?.blob);
        expect(differing.map(([path]) => path)).toEqual([]);
      });

      it("keeps upstream's executable bits", () => {
        const differing = Object.entries(upstream.files).filter(([path, file]) => {
          const executable = (statSync(join(realPluginDir(name), path)).mode & 0o111) !== 0;
          return executable !== (file.mode === "100755");
        });
        expect(differing.map(([path]) => path)).toEqual([]);
      });
    });
  }
});

describe("gitBlobSha", () => {
  it("is git's blob hash", () => {
    // `git hash-object /dev/null` and `printf 'hello\n' | git hash-object --stdin`.
    expect(gitBlobSha(new Uint8Array())).toBe("e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
    expect(gitBlobSha(new TextEncoder().encode("hello\n"))).toBe("ce013625030ba8dba906f756967f9e9ca394464a");
  });
});

describe("hookifyExampleRule", () => {
  it("places an example where hookify globs its rules", () => {
    const rule = hookifyExampleRule("dangerous-rm");
    expect(rule.path).toBe(".claude/hookify.dangerous-rm.local.md");
    expect(rule.content).toContain("action: block");
    expect(rule.content).toContain("pattern: rm\\s+-rf");
  });
});
