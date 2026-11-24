#!/usr/bin/env node

import { parseArgs } from "node:util";

// Keep this standalone request on the same version as square-source.ts.
const squareVersion = "2026-09-16";
const locationsUrl = "https://connect.squareup.com/v2/locations";
const squareId = /^[A-Za-z0-9_-]{1,192}$/;
const maxTokenBytes = 4096;
const maxResponseBytes = 2 * 1024 * 1024;
const usage = `Usage: node scripts/square-production-preflight.mjs [--location-id <Square location ID>]

Pass a Square production access token on stdin or in SQUARE_PRODUCTION_ACCESS_TOKEN.
With --location-id, require exactly one matching active location and print its profile.`;

class PreflightError extends Error {}

async function readToken() {
  let token = process.env.SQUARE_PRODUCTION_ACCESS_TOKEN?.trim();
  if (!token && !process.stdin.isTTY) {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of process.stdin) {
      bytes += chunk.length;
      if (bytes > maxTokenBytes + 2) throw new PreflightError("Square production token input is too long.");
      chunks.push(chunk);
    }
    token = Buffer.concat(chunks).toString("utf8").trim();
  }
  if (!token || token.length > maxTokenBytes || !/^[!-~]+$/.test(token)) {
    throw new PreflightError("Provide a valid Square production access token on stdin or in SQUARE_PRODUCTION_ACCESS_TOKEN.");
  }
  return token;
}

async function readLocations(token) {
  const response = await fetch(locationsUrl, {
    method: "GET",
    headers: { authorization: `Bearer ${token}`, accept: "application/json", "Square-Version": squareVersion },
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new PreflightError(`Square rejected the production location lookup (HTTP ${response.status}).`);
  }
  if (!response.body) throw new PreflightError("Square returned no location data.");

  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > maxResponseBytes) throw new PreflightError("Square location response exceeds the preflight size limit.");
    chunks.push(chunk);
  }
  let data;
  try {
    data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new PreflightError("Square did not return a valid location list.");
  }
  if (!Array.isArray(data?.locations) || (data.errors !== undefined && (!Array.isArray(data.errors) || data.errors.length > 0))) {
    throw new PreflightError("Square did not return a valid location list.");
  }
  return data.locations;
}

function toProfile(location) {
  const { id, name, merchant_id: merchantId, timezone, currency } = location;
  if (typeof id !== "string" || !squareId.test(id) || typeof merchantId !== "string" || !squareId.test(merchantId)
    || typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency) || typeof timezone !== "string" || !timezone) {
    throw new PreflightError("Square returned an incomplete active location profile.");
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    throw new PreflightError("Square returned a location with an invalid time zone.");
  }
  const displayName = typeof name === "string" ? name.replace(/[\p{Cc}\p{Cf}]/gu, " ").trim().slice(0, 255) : "";
  return { name: displayName || null, location_id: id, merchant_id: merchantId, timezone, currency };
}

async function main() {
  let values;
  try {
    ({ values } = parseArgs({ options: { help: { type: "boolean", short: "h" }, "location-id": { type: "string" } } }));
  } catch {
    throw new PreflightError(usage);
  }
  if (values.help) {
    console.log(usage);
    return;
  }
  const locationId = values["location-id"];
  if (locationId !== undefined && !squareId.test(locationId)) throw new PreflightError("Enter a valid Square location ID.");

  const token = await readToken();
  const locations = await readLocations(token);
  const matches = locations.filter((location) => location?.status === "ACTIVE" && (!locationId || location.id === locationId));
  if (locationId && matches.length !== 1) throw new PreflightError("Square did not return exactly one active location for the specified ID.");
  console.log(JSON.stringify({ environment: "production", active_locations: matches.map(toProfile) }, null, 2));
}

try {
  await main();
} catch (error) {
  // Print only errors we constructed, never raw provider responses, tokens, or fetch details.
  console.error(error instanceof PreflightError ? error.message : "Square production location lookup failed. Check network access and try again.");
  process.exitCode = 1;
}
