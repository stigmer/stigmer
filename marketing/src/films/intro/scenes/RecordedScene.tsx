import type * as React from "react";
import {
  AbsoluteFill,
  OffthreadVideo,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
import type { Cut } from "../../../../films/intro/manifest";
import { FPS } from "../../../../films/intro/manifest";
import { theme } from "../../../theme";
import { GRAPHICS } from "../graphics";
import { FramedShot } from "./FramedShot";
import type { ApplyTranscript } from "./TerminalScene";
import { TerminalScene } from "./TerminalScene";
import { YamlPanel } from "./YamlPanel";

/** Film data loaded at composition-metadata time (all gitignored, re-derivable). */
export interface FilmData {
  /** Shot ids with a take on disk (assets/recordings/<id>.webm). */
  recordedShots: string[];
  /** The staged agent manifest text for the S3b code panel. */
  agentYaml: string | null;
  /** The captured `stigmer apply` transcript for the S3e terminal. */
  transcript: ApplyTranscript | null;
}

/**
 * A scene assembled from the manifest's editorial cuts: real recordings
 * trimmed at their cut points, the two rendered-data panels (YAML,
 * terminal), and brand graphics resolved through the graphics registry.
 * A cut whose asset (or registered graphic) is missing falls back to a
 * slate, so the film always renders.
 */
export const RecordedScene = ({
  cuts,
  durationInFrames,
  data,
}: {
  cuts: Cut[];
  durationInFrames: number;
  data: FilmData;
}) => (
  <AbsoluteFill style={{ background: theme.colors.ink }}>
    {cuts.map((cut, i) => {
      const from = Math.round(cut.atSec * FPS);
      const next = i + 1 < cuts.length ? cuts[i + 1] : null;
      // A cross-dissolving successor overlaps this cut: keep playing
      // beneath it for the dissolve, then hand over (later siblings
      // stack above, so the successor's fade-in covers this tail).
      const until = next
        ? Math.round((next.atSec + (next.fadeInSec ?? 0)) * FPS)
        : durationInFrames;
      const cutFrames = until - from;
      if (cutFrames <= 0) return null;
      return (
        <Sequence key={`${cut.shot}-${i}`} from={from} durationInFrames={cutFrames} name={cut.shot}>
          <CutFade fadeInFrames={i > 0 ? Math.round((cut.fadeInSec ?? 0) * FPS) : 0}>
            <CutView cut={cut} cutFrames={cutFrames} data={data} />
          </CutFade>
        </Sequence>
      );
    })}
  </AbsoluteFill>
);

/** Opacity ramp for a cut that cross-dissolves in from its predecessor. */
const CutFade = ({ fadeInFrames, children }: { fadeInFrames: number; children: React.ReactNode }) => {
  const frame = useCurrentFrame();
  if (fadeInFrames <= 0) return <>{children}</>;
  const opacity = interpolate(frame, [0, fadeInFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};

const CutView = ({ cut, cutFrames, data }: { cut: Cut; cutFrames: number; data: FilmData }) => {
  switch (cut.kind) {
    case "recording":
      if (!data.recordedShots.includes(cut.shot)) return <SlateCut label={`${cut.shot} — take missing`} />;
      return (
        <FramedShot camera={cut.camera} spotlights={cut.spotlights}>
          <OffthreadVideo
            src={staticFile(`recordings/${cut.shot}.webm`)}
            startFrom={Math.round((cut.srcStartSec ?? 0) * FPS)}
            muted
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        </FramedShot>
      );
    case "yaml-panel":
      if (data.agentYaml === null) return <SlateCut label={`${cut.shot} — run capture:transcript`} />;
      return <YamlPanel yaml={data.agentYaml} durationInFrames={cutFrames} />;
    case "terminal":
      if (data.transcript === null) return <SlateCut label={`${cut.shot} — run capture:transcript`} />;
      return <TerminalScene transcript={data.transcript} />;
    case "graphic": {
      const Graphic = GRAPHICS[cut.shot];
      if (Graphic === undefined) return <SlateCut label={`${cut.shot} — graphic not registered`} />;
      return <Graphic durationInFrames={cutFrames} data={data} />;
    }
    case "slate":
      return <SlateCut label={cut.shot} />;
    default: {
      const exhaustive: never = cut.kind;
      throw new Error(`unhandled cut kind: ${exhaustive}`);
    }
  }
};

/** Minimal stand-in for a cut whose asset is pending (or a planned graphic). */
const SlateCut = ({ label }: { label: string }) => (
  <AbsoluteFill
    style={{
      background: theme.colors.ink,
      justifyContent: "center",
      alignItems: "center",
      fontFamily: theme.fonts.mono,
    }}
  >
    <div style={{ color: theme.colors.accent, fontSize: 30 }}>{label}</div>
  </AbsoluteFill>
);
