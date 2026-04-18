/**
 * Example: Mint Stigmer user tokens with PlatformClient credentials.
 *
 * This minimal Express server exposes a /api/stigmer-token endpoint
 * that platform builders call from their React frontend. The React SDK's
 * StigmerProvider uses getAccessToken to fetch from this endpoint.
 *
 * Prerequisites:
 *   STIGMER_CLIENT_ID   — PlatformClient client_id
 *   STIGMER_CLIENT_SECRET — PlatformClient client_secret
 *
 * This is NOT a runnable program — it shows the API patterns.
 * A real implementation would add your own auth middleware.
 */

import express from "express";
import { createPlatformClientAuth } from "@stigmer/sdk/node";

const app = express();

const auth = createPlatformClientAuth({
  baseUrl: "https://api.stigmer.ai",
  clientId: process.env.STIGMER_CLIENT_ID!,
  clientSecret: process.env.STIGMER_CLIENT_SECRET!,
});

app.get("/api/stigmer-token", async (req, res) => {
  // In production, authenticate the request with your own auth system
  // and extract the user identity from the session.
  const userId = req.query.userId as string;

  try {
    const { accessToken, expiresAt } = await auth.mintUserToken({
      userId,
      userEmail: req.query.email as string,
      userName: req.query.name as string,
    });

    res.json({ accessToken, expiresAt: expiresAt.toISOString() });
  } catch (error) {
    console.error("Failed to mint token:", error);
    res.status(500).json({ error: "Failed to mint Stigmer token" });
  }
});

app.listen(3001, () => {
  console.log("Token endpoint running at http://localhost:3001/api/stigmer-token");
});
