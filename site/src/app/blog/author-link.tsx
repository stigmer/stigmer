"use client";

export function AuthorLink({
  github,
  children,
}: {
  github: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={`https://github.com/${github}`}
      target="_blank"
      rel="noopener noreferrer"
      className="hover:text-foreground transition-colors"
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </a>
  );
}
