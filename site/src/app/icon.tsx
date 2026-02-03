import { ImageResponse } from "next/og";

// App icon configuration
// Generates favicons dynamically for optimal quality across all browsers and devices
export const runtime = "edge";
export const dynamic = "force-static";
export const contentType = "image/png";

// Generate multiple sizes for different contexts
// Next.js will call this for each size specified in the metadata
export const size = {
  width: 32,
  height: 32,
};

export default async function Icon() {
  // For the favicon, we'll create a simple solid color icon with the "S" letter
  // This is a temporary solution until we have a proper vector logo
  // Using brand colors from the design system
  
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
          borderRadius: "20%",
        }}
      >
        <div
          style={{
            fontSize: 20,
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
