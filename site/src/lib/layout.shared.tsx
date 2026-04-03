import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { StigmerIcon } from "@/components/ui/stigmer-icon";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: <StigmerIcon size={32} />,
    },
  };
}
