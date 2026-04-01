import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="inline-flex items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/Icon-bw.svg"
            alt="Stigmer"
            width={24}
            height={24}
          />
        </span>
      ),
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
