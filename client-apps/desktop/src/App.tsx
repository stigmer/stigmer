import { useMemo } from "react";
import { Stigmer } from "@stigmer/sdk";
import { StigmerProvider } from "@stigmer/react";

const BASE_URL = import.meta.env.VITE_STIGMER_API_URL ?? "http://localhost:9090";

export function App() {
  const client = useMemo(
    () =>
      new Stigmer({
        baseUrl: BASE_URL,
        getAccessToken: () => null,
      }),
    [],
  );

  return (
    <StigmerProvider client={client} deploymentMode="local">
      <main className="flex h-screen flex-col items-center justify-center gap-6 bg-background text-foreground">
        <StigmerLogo />
        <h1 className="text-3xl font-semibold tracking-tight">
          Stigmer Desktop
        </h1>
        <p className="max-w-md text-center text-muted-foreground">
          Native desktop experience for sessions, agents, runner management,
          and settings &mdash; powered by the same SDK as the web console.
        </p>
        <div className="flex gap-3">
          <Pill label="SDK" value="@stigmer/react" />
          <Pill label="Shell" value="Tauri 2.x" />
          <Pill label="Theme" value="--stgm-*" />
        </div>
      </main>
    </StigmerProvider>
  );
}

function StigmerLogo() {
  return (
    <svg
      width="64"
      height="64"
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Stigmer logo"
    >
      <rect
        width="64"
        height="64"
        rx="16"
        className="fill-primary"
      />
      <text
        x="32"
        y="42"
        textAnchor="middle"
        className="fill-primary-foreground"
        fontSize="28"
        fontWeight="700"
        fontFamily="var(--stgm-font-sans)"
      >
        S
      </text>
    </svg>
  );
}

function Pill({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm">
      <span className="font-medium text-foreground">{label}</span>
      <span className="text-muted-foreground">{value}</span>
    </span>
  );
}
