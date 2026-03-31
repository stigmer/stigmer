import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="inline-flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo-square.svg"
            alt=""
            width={24}
            height={24}
            className="rounded"
          />
          <span className="font-bold">Stigmer</span>
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
