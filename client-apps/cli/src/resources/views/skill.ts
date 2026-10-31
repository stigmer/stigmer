// `get skill`: which version of a skill this is and where it came from, then
// the start of its SKILL.md. The tag and the version hash (by the short form
// the CLI prints for versions), the git remote, ref and commit it was pushed
// from, when it was; SKILL.md without its frontmatter, whose name and
// description the title and summary already show
// (apis/ai/stigmer/agentic/skill/v1/spec.proto, status.proto).

import { obj, str } from "../render.js";
import { shortVersionHash } from "../version.js";
import type { KindView } from "./view.js";
import { firstLines } from "./words.js";

export const skillView: KindView = {
  sections: (json) => {
    const spec = obj(json, "spec");
    const status = obj(json, "status");
    const git = obj(status, "git_provenance");
    const body = firstLines(withoutFrontmatter(str(spec, "skill_md")));
    return [
      {
        fields: [
          ["Description", str(spec, "description")],
          ["Tag", str(spec, "tag")],
          ["Version", shortVersionHash(str(status, "version_hash"))],
        ],
      },
      {
        title: "Source",
        fields: [
          ["Remote", str(git, "remote_url")],
          ["Ref", str(git, "ref")],
          ["Commit", str(git, "commit")],
          ["Folder", str(git, "subdir")],
        ],
      },
      { title: "SKILL.md", lines: body.lines, more: body.more },
    ];
  },
};

/** SKILL.md from its first line after the YAML frontmatter (and the blank lines after it); as given when it has none. */
export function withoutFrontmatter(markdown: string): string {
  const text = markdown.replace(/\r\n/g, "\n");
  if (!text.startsWith("---\n")) return text;
  const close = text.indexOf("\n---", 3);
  if (close === -1) return text;
  const after = text.indexOf("\n", close + 4);
  return after === -1 ? "" : text.slice(after + 1).replace(/^\n+/, "");
}
