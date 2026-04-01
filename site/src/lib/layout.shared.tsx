import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { StigmerIcon } from "@/components/ui/stigmer-icon";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: <StigmerIcon size={24} />,
    },
    links: [
      {
        text: "Use Cases",
        url: "/use-cases",
      },
      {
        text: "GitHub",
        url: "https://github.com/stigmer/stigmer",
        external: true,
      },
    ],
  };
}
