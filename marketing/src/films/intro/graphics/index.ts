import type * as React from "react";
import { CloudMorph } from "./CloudMorph";
import { EmbedSnippet } from "./EmbedSnippet";
import { EmbedTease } from "./EmbedTease";
import { EndCard } from "./EndCard";
import { LaptopToCloud } from "./LaptopToCloud";
import { LogoReveal } from "./LogoReveal";
import { MeridianEstablishing } from "./MeridianEstablishing";
import { TitleCard } from "./TitleCard";
import { YamlMorph } from "./YamlMorph";
import type { GraphicProps } from "./types";

/**
 * The graphics registry: manifest cut/overlay ids → components. The
 * manifest stays pure editorial data; this is the one place an id gains
 * a visual. An id missing here degrades to the standard slate (cuts) or
 * renders nothing (overlays), so the film renders end to end while
 * graphics are still being built.
 */
export const GRAPHICS: Record<string, React.FC<GraphicProps>> = {
  "s1b-logo-reveal": LogoReveal,
  "s1c-embed-tease": EmbedTease,
  "s2a-title-infra": TitleCard({ index: "01", title: "Agents are infrastructure" }),
  "s2b-yaml-morph": YamlMorph,
  "s2c-laptop-cloud": LaptopToCloud,
  "s2d-title-trust": TitleCard({ index: "02", title: "Execution you can trust" }),
  "s3a-establishing": MeridianEstablishing,
  "s4d-snippet": EmbedSnippet,
  "s5d-cloud-morph": CloudMorph,
  "s6b-end-card": EndCard,
};

export type { GraphicProps } from "./types";
