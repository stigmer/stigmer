import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import { Step, Steps } from "fumadocs-ui/components/steps";
import { TypeTable } from "fumadocs-ui/components/type-table";
import { File, Files, Folder } from "fumadocs-ui/components/files";
import { ImageZoom } from "fumadocs-ui/components/image-zoom";
import { Accordion, Accordions } from "fumadocs-ui/components/accordion";
import { Card, Cards } from "fumadocs-ui/components/card";
import { Diagram, FirstJob, Hero, Mermaid, ReactSdkDomains, SDKTabs, Term } from "@/components/docs";
import { Live } from "@/components/visuals/Live";
import { Screen } from "@/components/visuals/Screen";
import { TerminalRecording } from "@/components/visuals/TerminalRecording";
import { ThemePlayground } from "@/components/visuals/ThemePlayground";

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    Tab,
    Tabs,
    Step,
    Steps,
    TypeTable,
    File,
    Files,
    Folder,
    ImageZoom,
    Accordion,
    Accordions,
    Card,
    Cards,
    Diagram,
    FirstJob,
    Hero,
    Live,
    Mermaid,
    ReactSdkDomains,
    Screen,
    SDKTabs,
    Term,
    TerminalRecording,
    ThemePlayground,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
