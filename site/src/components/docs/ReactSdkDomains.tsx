import summary from "@/data/react-sdk-summary.json";

interface DomainEntry {
  slug: string;
  title: string;
  description: string;
  hooks: number;
  components: number;
}

const domains: DomainEntry[] = summary.domains;

function formatCount(n: number): string {
  return n > 0 ? String(n) : "—";
}

export function ReactSdkDomains() {
  return (
    <div className="overflow-x-auto">
      <table>
        <thead>
          <tr>
            <th>Domain</th>
            <th>Description</th>
            <th style={{ textAlign: "center" }}>Hooks</th>
            <th style={{ textAlign: "center" }}>Components</th>
          </tr>
        </thead>
        <tbody>
          {domains.map((d) => (
            <tr key={d.slug}>
              <td>
                <a href={`/docs/sdk/react/${d.slug}`}>{d.title}</a>
              </td>
              <td>{d.description}</td>
              <td style={{ textAlign: "center" }}>{formatCount(d.hooks)}</td>
              <td style={{ textAlign: "center" }}>
                {formatCount(d.components)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
