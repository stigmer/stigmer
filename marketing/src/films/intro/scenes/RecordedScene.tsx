import { AbsoluteFill, OffthreadVideo, Sequence, staticFile } from "remotion";
import type { Cut } from "../../../../films/intro/manifest";
import { FPS } from "../../../../films/intro/manifest";
import { theme } from "../../../theme";
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
 * terminal), and slates for shots whose assets are still pending (S3a
 * and S5d motion graphics, S4d awaiting its cloud take). A cut whose
 * asset is missing falls back to a slate, so the film always renders.
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
      const until = i + 1 < cuts.length ? Math.round(cuts[i + 1].atSec * FPS) : durationInFrames;
      const cutFrames = until - from;
      if (cutFrames <= 0) return null;
      return (
        <Sequence key={`${cut.shot}-${i}`} from={from} durationInFrames={cutFrames} name={cut.shot}>
          <CutView cut={cut} cutFrames={cutFrames} data={data} />
        </Sequence>
      );
    })}
  </AbsoluteFill>
);

const CutView = ({ cut, cutFrames, data }: { cut: Cut; cutFrames: number; data: FilmData }) => {
  switch (cut.kind) {
    case "recording":
      if (!data.recordedShots.includes(cut.shot)) return <SlateCut label={`${cut.shot} — take missing`} />;
      return (
        <AbsoluteFill style={{ background: "#fff" }}>
          <OffthreadVideo
            src={staticFile(`recordings/${cut.shot}.webm`)}
            startFrom={Math.round((cut.srcStartSec ?? 0) * FPS)}
            muted
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        </AbsoluteFill>
      );
    case "yaml-panel":
      if (data.agentYaml === null) return <SlateCut label={`${cut.shot} — run capture:transcript`} />;
      return <YamlPanel yaml={data.agentYaml} durationInFrames={cutFrames} />;
    case "terminal":
      if (data.transcript === null) return <SlateCut label={`${cut.shot} — run capture:transcript`} />;
      return <TerminalScene transcript={data.transcript} />;
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
