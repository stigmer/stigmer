"use client";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif" }}>
        <div
          style={{
            display: "flex",
            minHeight: "100vh",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div style={{ textAlign: "center", maxWidth: 400 }}>
            <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
              Something went wrong
            </h1>
            <p style={{ color: "#666", fontSize: 14, marginBottom: 24 }}>
              An unexpected error occurred.
            </p>
            <button
              onClick={reset}
              style={{
                padding: "8px 16px",
                borderRadius: 8,
                border: "none",
                background: "#111",
                color: "#fff",
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
