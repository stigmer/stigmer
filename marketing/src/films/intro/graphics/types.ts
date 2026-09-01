import type { FilmData } from "../scenes/RecordedScene";

/** Props every registered graphic receives from its cut or overlay slot. */
export interface GraphicProps {
  durationInFrames: number;
  /**
   * Captured footage + staged film data, passed by graphic cuts — for
   * graphics built over real assets (the S2b morph animates the actual
   * staged agent YAML). Overlay slots omit it; brand-only graphics
   * ignore it.
   */
  data?: FilmData;
}
