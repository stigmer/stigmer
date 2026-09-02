import { useMemo, useState } from "react";
import { Stigmer } from "@stigmer/sdk";
import { NewSessionViewer, SessionViewer, StigmerProvider } from "@stigmer/react";
import "@stigmer/react/styles.css";

/**
 * Meridian Travel's "Manage my trip" page with the travel assistant
 * integrated through @stigmer/react — the platform-builder integration
 * the film's scene-4 payoff beat records (and the same wiring shape as
 * the SDK's real product consumers): one client, one provider, one
 * session component pinned to the org's agent with the endUser audience.
 *
 * Runs against the local stack (trusted-local identity — no token), so
 * the whole film remains reproducible from a laptop.
 */

const ORG = "meridian-travel";
const AGENT = { org: ORG, slug: "traveler-assist" };

const TravelAssistant = () => {
  // Local stack, trusted-local identity: no bearer token is sent (the
  // console's own anonymous-client pattern), the server trusts localhost.
  const stigmer = useMemo(
    () => new Stigmer({ baseUrl: "http://localhost:7234", getAccessToken: () => null }),
    [],
  );
  const [sessionId, setSessionId] = useState<string | null>(null);
  return (
    <StigmerProvider client={stigmer}>
      {sessionId === null ? (
        <NewSessionViewer
          org={ORG}
          audience="endUser"
          initialAgentRef={AGENT}
          heading="How can we help with your trip?"
          placeholder="e.g. Move my flight to tomorrow morning"
          onSessionCreated={setSessionId}
        />
      ) : (
        <SessionViewer sessionId={sessionId} org={ORG} audience="endUser" />
      )}
    </StigmerProvider>
  );
};

export const App = () => (
  <>
    <header>
      <div className="brand">
        <div className="brand-mark" />
        Meridian Travel
      </div>
      <nav>
        <span>Book</span>
        <span>My trips</span>
        <span>Help</span>
      </nav>
    </header>
    <main>
      <section>
        <h1>Manage my trip</h1>
        <p className="lede">
          Your upcoming itinerary. Need to change something? Ask the assistant — it can search
          flights and rebook you in minutes.
        </p>
        <div className="trip">
          <div className="ref">BOOKING&nbsp;MT-4821</div>
          <div className="route">
            <span className="city">SFO</span>
            <span className="arrow">→</span>
            <span className="city">JFK</span>
          </div>
          <div className="meta">
            <span>Flight MT-214</span>
            <span>Sep 10, 2026 · 6:15 PM</span>
            <span>Priya Shah</span>
          </div>
          <span className="badge">FLEX FARE</span>
        </div>
      </section>
      <aside>
        <h2>Travel assistant</h2>
        <p>Rebook flights, check options, and get policy answers — right here.</p>
        <div id="assistant-panel">
          <TravelAssistant />
        </div>
      </aside>
    </main>
  </>
);
