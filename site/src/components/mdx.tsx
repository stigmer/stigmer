import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import { Step, Steps } from "fumadocs-ui/components/steps";
import { TypeTable } from "fumadocs-ui/components/type-table";
import { File, Files, Folder } from "fumadocs-ui/components/files";
import { ImageZoom } from "fumadocs-ui/components/image-zoom";
import { Accordion, Accordions } from "fumadocs-ui/components/accordion";
import { Card, Cards } from "fumadocs-ui/components/card";
import { DemoApprovalFlowPlayback, DemoByoaSetup, DemoConnectSlackChannel, DemoConnectWhatsAppChannel, DemoMarketplaceConnectTour, DemoOAuthConnectFlow, DemoThemingPlayground, DemoToolCallsPlayback, HarnessCostComparison, Hero, Mermaid, ReactSdkDomains, ScenarEmbed, SDKTabs, Term } from "@/components/docs";

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
    DemoApprovalFlowPlayback,
    DemoByoaSetup,
    DemoConnectSlackChannel,
    DemoConnectWhatsAppChannel,
    DemoMarketplaceConnectTour,
    DemoOAuthConnectFlow,
    DemoThemingPlayground,
    DemoToolCallsPlayback,
    HarnessCostComparison,
    Hero,
    Mermaid,
    ReactSdkDomains,
    ScenarEmbed,
    SDKTabs,
    Term,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
