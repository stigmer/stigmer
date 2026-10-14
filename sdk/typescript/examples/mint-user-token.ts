/**
 * Example: mint Stigmer user tokens from your product's backend.
 *
 * This minimal Express server exposes a /api/stigmer-token endpoint that
 * your React frontend calls; the React SDK's StigmerProvider fetches from
 * it through getAccessToken.
 *
 * Prerequisites:
 *   STIGMER_API_KEY — an API key of a service account with the admin role
 *                     in your organization (Settings > Service accounts)
 *   STIGMER_ORG     — your organization's slug
 *
 * This is NOT a runnable program — it shows the API patterns.
 * A real implementation would add your own auth middleware.
 */

import express from "express";
import { createNodeClient } from "@stigmer/sdk/node";

const app = express();

const stigmer = createNodeClient({
  baseUrl: "https://api.stigmer.ai",
  apiKey: process.env.STIGMER_API_KEY!,
});

app.get("/api/stigmer-token", async (req, res) => {
  // In production, authenticate the request with your own auth system
  // and take the person's identity from the session.
  const userId = req.query.userId as string;

  try {
    const { accessToken, expiresAt } = await stigmer.tokens.mintUserToken({
      org: process.env.STIGMER_ORG!,
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
