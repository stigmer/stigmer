import type * as React from "react";
import { EndCard } from "./EndCard";
import { MeridianEstablishing } from "./MeridianEstablishing";
import { TitleCard } from "./TitleCard";
import type { GraphicProps } from "./types";

/**
 * The graphics registry: manifest cut/overlay ids → components. The
 * manifest stays pure editorial data; this is the one place an id gains
 * a visual. An id missing here degrades to the standard slate, so the
 * film renders end to end while graphics are still being built.
 */
export const GRAPHICS: Record<string, React.FC<GraphicProps>> = {
  "s2a-title-infra": TitleCard({ index: "01", title: "Agents are infrastructure" }),
  "s2d-title-trust": TitleCard({ index: "02", title: "Execution you can trust" }),
  "s3a-establishing": MeridianEstablishing,
  "s6b-end-card": EndCard,
};

export type { GraphicProps } from "./types";
