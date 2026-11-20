import defaultMdxComponents from "fumadocs-ui/mdx";
import type { ComponentProps } from "react";
import type { MDXComponents } from "mdx/types";
import { CodeBlock, Pre } from "fumadocs-ui/components/codeblock";
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
import { SCROLL_REGION } from "@/lib/scroll-region";
import { cn } from "@/lib/utils";

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    // fumadocs' own `pre`, its scroll area made a Tab stop (src/lib/scroll-region.ts).
    pre: (props: ComponentProps<"pre">) => (
      <CodeBlock {...props} viewportProps={SCROLL_REGION}>
        <Pre>{props.children}</Pre>
      </CodeBlock>
    ),
    // fumadocs' own table wrapper, drawn here because fumadocs gives its props
    // to the <table>, made a Tab stop the same way.
    table: (props: ComponentProps<"table">) => (
      <div {...SCROLL_REGION} className={cn("relative overflow-auto prose-no-margin my-6", SCROLL_REGION.className)}>
        <table {...props} />
      </div>
    ),
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
