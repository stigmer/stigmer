import { AbsoluteFill, OffthreadVideo, staticFile } from "remotion";
import { theme } from "../../theme";
import { GRID, TYPE } from "./graphics/motion";
import { StigmerMark } from "./graphics/StigmerMark";

/**
 * The film's YouTube thumbnail — a Still, so it stays in-repo and
 * re-renderable (the same doctrine as the docs' "rendered, never
 * hand-captured" rule). Deliberately static: the graphics' `enter()`
 * springs are 0 at frame 0, which is the only frame a still has, so
 * motion helpers would render everything invisible here.
 *
 * The layout is the headline-dominant candidate chosen at the thumbnail
 * gate (stigmer-cloud project 20260902.01.stigmer-intro-video): oversized
 * headline left, the presenter right, the mark as a corner signature —
 * sized to stay readable at YouTube's ~320px search-result card.
 *
 * The presenter image is a single frame of the gitignored HeyGen clip
 * (assets/presenter/), resolved with the film's degrade contract: when
 * the clip is absent the still renders the brand-only layout rather
 * than a broken frame.
 */

export type ThumbnailProps = {
  /** Computed at metadata time from getStaticFiles(); never set by hand. */
  hasPresenter: boolean;
};

/** YouTube's minimum canvas; the film's TYPE scale is authored at 1080p. */
export const THUMB_WIDTH = 1280;
export const THUMB_HEIGHT = 720;
const S = THUMB_HEIGHT / 1080;

/**
 * The frame of s6-close used as the portrait: ~9s in, her open-hands
 * "here it is" beat — the most inviting moment across the three clips
 * (chosen at the thumbnail gate).
 */
const PRESENTER_CLIP = "presenter/s6-close.mp4";
const PRESENTER_FRAME = 270;

export const Thumbnail = ({ hasPresenter }: ThumbnailProps) => (
  <AbsoluteFill
    style={{ background: theme.colors.ink, fontFamily: theme.fonts.sans }}
  >
    {hasPresenter ? (
      <>
        <PresenterSide />
        <AbsoluteFill style={{ justifyContent: "center", paddingLeft: 18 * GRID * S, width: "62%" }}>
          <Headline fontSize={TYPE.display * S * 1.25} />
        </AbsoluteFill>
        <div style={{ position: "absolute", top: 4 * GRID, left: 4 * GRID }}>
          <StigmerMark size={8 * GRID} />
        </div>
      </>
    ) : (
      <BrandOnly />
    )}
  </AbsoluteFill>
);

/**
 * Abigail on the right: the 16:9 clip frame is pushed right and scaled so
 * she sits in the right third, then a left gradient carves out a solid
 * ink column for the copy. Gradient (not a hard seam) keeps her office
 * set reading as one continuous backdrop.
 */
const PresenterSide = () => (
  <>
    <AbsoluteFill style={{ transform: "translateX(24%) scale(1.3)" }}>
      <OffthreadVideo
        src={staticFile(PRESENTER_CLIP)}
        startFrom={PRESENTER_FRAME}
        muted
      />
    </AbsoluteFill>
    <AbsoluteFill
      style={{
        background: `linear-gradient(90deg, ${theme.colors.ink} 34%, ${theme.colors.ink}e6 44%, transparent 72%)`,
      }}
    />
  </>
);

const Headline = ({ fontSize }: { fontSize: number }) => (
  <div style={{ fontSize, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.08 }}>
    <div style={{ color: theme.colors.paper }}>Define once.</div>
    <div style={{ color: theme.colors.accent }}>Run anywhere.</div>
  </div>
);

/** Degrade layout in the end card's language — needs no generated media. */
const BrandOnly = () => (
  <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", textAlign: "center" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 3 * GRID }}>
      <StigmerMark size={16 * GRID} />
      <div
        style={{
          fontSize: TYPE.display * S,
          fontWeight: 700,
          letterSpacing: "-0.02em",
          color: theme.colors.paper,
        }}
      >
        Stigmer
      </div>
    </div>
    <div style={{ height: 5 * GRID }} />
    <Headline fontSize={TYPE.headline * S * 1.2} />
  </AbsoluteFill>
);
