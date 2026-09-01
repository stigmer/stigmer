#!/usr/bin/env node
/**
 * meridian-ops — the MCP server behind the Intro to Stigmer film's demo
 * company, Meridian Travel. A real stdio server (official MCP SDK): the
 * local runner spawns it, discovers its tools, and the approval gate on
 * rebook_booking fires genuinely on camera.
 *
 * Every output is DETERMINISTIC — flight options and confirmations derive
 * only from the tool arguments and the fixture tables below, never from
 * the clock or randomness — so a film take can be re-shot and the screen
 * content matches cut-for-cut.
 *
 * Fixtures align with skills/rebooking-policy/SKILL.md: fare classes and
 * change fees here are the ones the policy document defines. Change one,
 * change both.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

/** Fare-class change fees, per rebooking-policy §2 (USD). */
const CHANGE_FEES = { saver: 99, standard: 49, flex: 0 };

/**
 * Flight schedule by route. Times are local, prices are one-way USD by
 * fare class. Small on purpose: the film needs believable screens, not
 * an inventory system.
 */
const SCHEDULE = {
  // One morning, one afternoon, one evening per route — "tomorrow
  // morning" always has exactly one honest answer, keeping the film's
  // single-message chat scene deterministic across takes.
  "SFO-JFK": [
    { flight_number: "MT-102", departs: "07:05", arrives: "15:38", fares: { saver: 189, standard: 259, flex: 342 } },
    { flight_number: "MT-118", departs: "13:40", arrives: "22:09", fares: { saver: 174, standard: 241, flex: 318 } },
    { flight_number: "MT-214", departs: "18:15", arrives: "02:44", fares: { saver: 152, standard: 219, flex: 300 } },
  ],
  "JFK-SFO": [
    { flight_number: "MT-103", departs: "08:20", arrives: "11:55", fares: { saver: 195, standard: 266, flex: 351 } },
    { flight_number: "MT-121", departs: "13:05", arrives: "16:33", fares: { saver: 168, standard: 237, flex: 309 } },
    { flight_number: "MT-219", departs: "19:45", arrives: "23:07", fares: { saver: 149, standard: 214, flex: 291 } },
  ],
};

/** Bookings on file. MT-4821 is the one the film's chat scene moves. */
const BOOKINGS = {
  "MT-4821": {
    booking_id: "MT-4821",
    traveler: "Priya Shah",
    route: "SFO-JFK",
    flight_number: "MT-214",
    date: "2026-09-10",
    fare_class: "flex",
    paid_usd: 300,
  },
  "MT-3377": {
    booking_id: "MT-3377",
    traveler: "Daniel Kim",
    route: "JFK-SFO",
    flight_number: "MT-121",
    date: "2026-09-12",
    fare_class: "saver",
    paid_usd: 168,
  },
};

const asText = (payload) => ({ content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] });
const asError = (message) => ({ isError: true, content: [{ type: "text", text: JSON.stringify({ error: message }) }] });

const server = new McpServer({ name: "meridian-ops", version: "1.0.0" });

server.registerTool(
  "get_booking",
  {
    description:
      "Look up a Meridian Travel booking by reference: traveler, route, current flight, date, and fare class.",
    inputSchema: {
      booking_id: z.string().describe("Booking reference, e.g. MT-4821"),
    },
  },
  async ({ booking_id }) => {
    const booking = BOOKINGS[booking_id.toUpperCase()];
    if (!booking) {
      return asError(`Booking ${booking_id} not found.`);
    }
    return asText(booking);
  },
);

server.registerTool(
  "search_flights",
  {
    description:
      "Search Meridian Travel's schedule for available flights on a route and date. Returns flight numbers, times, and per-fare-class prices.",
    inputSchema: {
      origin: z.string().length(3).describe("Origin airport IATA code, e.g. SFO"),
      destination: z.string().length(3).describe("Destination airport IATA code, e.g. JFK"),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Travel date, YYYY-MM-DD"),
    },
  },
  async ({ origin, destination, date }) => {
    const route = `${origin.toUpperCase()}-${destination.toUpperCase()}`;
    const flights = SCHEDULE[route];
    if (!flights) {
      return asError(`No Meridian Travel service on route ${route}. Served routes: ${Object.keys(SCHEDULE).join(", ")}.`);
    }
    return asText({
      route,
      date,
      options: flights.map((f) => ({ ...f, date })),
    });
  },
);

server.registerTool(
  "rebook_booking",
  {
    description:
      "Rebook an existing Meridian Travel booking onto a different flight. Charges or refunds the fare difference and any change fee per the rebooking policy. This modifies the traveler's itinerary.",
    inputSchema: {
      booking_id: z.string().describe("Booking reference, e.g. MT-4821"),
      flight_number: z.string().describe("Target flight number from search_flights, e.g. MT-102"),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("New travel date, YYYY-MM-DD"),
    },
  },
  async ({ booking_id, flight_number, date }) => {
    const booking = BOOKINGS[booking_id.toUpperCase()];
    if (!booking) {
      return asError(`Booking ${booking_id} not found.`);
    }
    const target = SCHEDULE[booking.route].find((f) => f.flight_number === flight_number.toUpperCase());
    if (!target) {
      return asError(`Flight ${flight_number} does not operate on route ${booking.route}.`);
    }
    const newFare = target.fares[booking.fare_class];
    const fareDifference = newFare - booking.paid_usd;
    const changeFee = CHANGE_FEES[booking.fare_class];
    return asText({
      confirmation: `RBK-${booking_id.slice(3)}-${target.flight_number.slice(3)}`,
      booking_id: booking.booking_id,
      traveler: booking.traveler,
      new_itinerary: { ...target, route: booking.route, date },
      fare_class: booking.fare_class,
      fare_difference_usd: fareDifference,
      change_fee_usd: changeFee,
      total_charge_usd: Math.max(0, fareDifference) + changeFee,
      status: "confirmed",
    });
  },
);

await server.connect(new StdioServerTransport());
