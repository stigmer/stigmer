import { ImageResponse } from "next/og";

// Twitter Card image - identical to Open Graph for consistency
// Note: We duplicate instead of re-export because Next.js static export
// cannot recognize re-exported runtime configuration
export const runtime = "edge";
export const dynamic = "force-static";
export const alt = "Stigmer — Agents as Microservices";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #0a0f1a 0%, #1a1f2e 100%)",
          position: "relative",
        }}
      >
        {/* Background gradient accent */}
        <div
          style={{
            position: "absolute",
            top: "-20%",
            right: "-10%",
            width: "50%",
            height: "50%",
            background: "linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)",
            opacity: 0.15,
            borderRadius: "50%",
            filter: "blur(100px)",
          }}
        />

        {/* Logo */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 140,
            height: 140,
            background: "linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)",
            borderRadius: 28,
            marginBottom: 40,
            boxShadow: "0 20px 60px rgba(59, 130, 246, 0.4)",
          }}
        >
          <div
            style={{
              fontSize: 80,
              fontWeight: 700,
              color: "white",
              fontFamily: "system-ui, -apple-system, sans-serif",
            }}
          >
            S
          </div>
        </div>

        {/* Brand name */}
        <div
          style={{
            fontSize: 72,
            fontWeight: 700,
            color: "white",
            fontFamily: "system-ui, -apple-system, sans-serif",
            marginBottom: 16,
            letterSpacing: "-0.02em",
          }}
        >
          Stigmer
        </div>

        {/* Tagline */}
        <div
          style={{
            fontSize: 42,
            fontWeight: 500,
            color: "#94a3b8",
            fontFamily: "system-ui, -apple-system, sans-serif",
            marginBottom: 32,
            letterSpacing: "-0.01em",
          }}
        >
          Agents as Microservices
        </div>

        {/* Key value proposition - short and impactful */}
        <div
          style={{
            fontSize: 28,
            color: "#cbd5e1",
            fontFamily: "system-ui, -apple-system, sans-serif",
            maxWidth: 900,
            textAlign: "center",
            lineHeight: 1.4,
            paddingLeft: 60,
            paddingRight: 60,
          }}
        >
          Build agents in YAML or Go. Deploy once. Call from everywhere via gRPC.
        </div>

        {/* Footer badges */}
        <div
          style={{
            display: "flex",
            gap: 16,
            marginTop: 48,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "12px 24px",
              background: "rgba(59, 130, 246, 0.1)",
              border: "1px solid rgba(59, 130, 246, 0.3)",
              borderRadius: 9999,
              fontSize: 20,
              color: "#3b82f6",
              fontFamily: "system-ui, -apple-system, sans-serif",
              fontWeight: 500,
            }}
          >
            Open Source
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "12px 24px",
              background: "rgba(139, 92, 246, 0.1)",
              border: "1px solid rgba(139, 92, 246, 0.3)",
              borderRadius: 9999,
              fontSize: 20,
              color: "#8b5cf6",
              fontFamily: "system-ui, -apple-system, sans-serif",
              fontWeight: 500,
            }}
          >
            gRPC APIs
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "12px 24px",
              background: "rgba(59, 130, 246, 0.1)",
              border: "1px solid rgba(59, 130, 246, 0.3)",
              borderRadius: 9999,
              fontSize: 20,
              color: "#3b82f6",
              fontFamily: "system-ui, -apple-system, sans-serif",
              fontWeight: 500,
            }}
          >
            YAML + SDK
          </div>
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}
