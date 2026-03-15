interface SectionProps {
  title: string;
  children: React.ReactNode;
}

function Section({ title, children }: SectionProps) {
  return (
    <section>
      <h3 className="text-muted-foreground mb-3 text-sm font-semibold tracking-wider uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

export { Section };
export type { SectionProps };
