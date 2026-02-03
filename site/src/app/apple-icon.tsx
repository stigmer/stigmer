import { ImageResponse } from "next/og";

// Apple Touch Icon - shown on iOS home screen
export const runtime = "edge";
export const dynamic = "force-static";
export const contentType = "image/png";

export const size = {
  width: 180,
  height: 180,
};

export default async function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)",
        }}
      >
        <div
          style={{
            fontSize: 100,
            fontWeight: 700,
            color: "white",
            fontFamily: "system-ui, -apple-system, sans-serif",
          }}
        >
          S
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}
