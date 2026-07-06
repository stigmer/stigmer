import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { ExecutionArtifactSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";
import { ExecutionArtifactKind } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { ArtifactContentBody } from "../ArtifactContentBody";
import type { SkillPackageDetection } from "../../library/detect-skill-package";

const NOT_SKILL: SkillPackageDetection = { detected: false };

function fileArtifact(name: string) {
  return create(ExecutionArtifactSchema, {
    name,
    kind: ExecutionArtifactKind.FILE,
    sizeBytes: 64n,
  });
}

function dirArtifact(name: string, entries: string[]) {
  return create(ExecutionArtifactSchema, {
    name,
    kind: ExecutionArtifactKind.DIRECTORY,
    sizeBytes: 512n,
    entries,
  });
}

afterEach(cleanup);

describe("ArtifactContentBody — file states", () => {
  it("renders a loading skeleton", () => {
    render(
      <ArtifactContentBody
        artifact={fileArtifact("notes.txt")}
        content={null}
        contentType={null}
        isLoading
        error={null}
        isTruncated={false}
        skillDetection={NOT_SKILL}
      />,
    );
    expect(screen.getByLabelText("Loading content")).toBeTruthy();
  });

  it("renders an error message", () => {
    render(
      <ArtifactContentBody
        artifact={fileArtifact("notes.txt")}
        content={null}
        contentType={null}
        isLoading={false}
        error={new Error("boom")}
        isTruncated={false}
        skillDetection={NOT_SKILL}
      />,
    );
    expect(screen.getByText("boom")).toBeTruthy();
  });

  it("renders the binary / unavailable state when content is null and settled", () => {
    render(
      <ArtifactContentBody
        artifact={fileArtifact("image.bin")}
        content={null}
        contentType={null}
        isLoading={false}
        error={null}
        isTruncated={false}
        skillDetection={NOT_SKILL}
      />,
    );
    expect(screen.getByText(/Content not available for preview/)).toBeTruthy();
  });

  it("renders text content", () => {
    render(
      <ArtifactContentBody
        artifact={fileArtifact("notes.txt")}
        content={"hello from the artifact"}
        contentType={"text/plain"}
        isLoading={false}
        error={null}
        isTruncated={false}
        skillDetection={NOT_SKILL}
      />,
    );
    expect(screen.getByText(/hello from the artifact/)).toBeTruthy();
  });
});

describe("ArtifactContentBody — directory state", () => {
  it("lists directory entries", () => {
    render(
      <ArtifactContentBody
        artifact={dirArtifact("pack", ["SKILL.md", "run.sh"])}
        content={null}
        contentType={null}
        isLoading={false}
        error={null}
        isTruncated={false}
        skillDetection={NOT_SKILL}
      />,
    );
    expect(screen.getByText("Files (2)")).toBeTruthy();
    expect(screen.getByText("SKILL.md")).toBeTruthy();
    expect(screen.getByText("run.sh")).toBeTruthy();
  });

  it("shows the skill banner when a skill package is detected", () => {
    const detection = {
      detected: true,
      skillName: "My Skill",
      skillDescription: "does things",
      fileCount: 2,
    } as unknown as SkillPackageDetection;
    render(
      <ArtifactContentBody
        artifact={dirArtifact("pack", ["SKILL.md"])}
        content={null}
        contentType={null}
        isLoading={false}
        error={null}
        isTruncated={false}
        skillDetection={detection}
      />,
    );
    expect(screen.getByText("My Skill")).toBeTruthy();
    expect(screen.getByText("does things")).toBeTruthy();
  });
});
