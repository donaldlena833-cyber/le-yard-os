#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const args = new Map(process.argv.slice(2).map((argument) => {
  const [key, ...rest] = argument.replace(/^--/, "").split("=");
  return [key, rest.join("=") || true];
}));
const locationId = String(args.get("location-id") ?? "").trim();
const name = String(args.get("name") ?? "Le Yard website").trim();
const origin = String(args.get("origin") ?? "").trim();
const apply = args.get("apply") === true;
if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(locationId) || !origin.startsWith("https://")) {
  throw new Error("Usage: npm run booking:create-client -- --location-id=<uuid> --origin=https://example.com [--name=...] [--apply]");
}
if (!apply) {
  process.stdout.write(`Dry run: would create scoped booking client "${name}" for ${origin}. Re-run with --apply after review.\n`);
  process.exit(0);
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const secret = process.env.SUPABASE_SECRET_KEY?.trim();
if (!url || !secret) throw new Error("Connected Supabase server environment is required.");
const supabase = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: location, error: locationError } = await supabase.from("locations").select("organization_id").eq("id", locationId).single();
if (locationError || !location) throw new Error("The active location was not found.");
const rawKey = `lyb_${randomBytes(32).toString("base64url")}`;
const keyHash = createHash("sha256").update(rawKey).digest("hex");
const { error } = await supabase.from("booking_api_clients").insert({ organization_id: location.organization_id, location_id: locationId, name, key_hash: keyHash, key_hint: rawKey.slice(-8), scopes: ["availability:read", "reservations:write"], allowed_origins: [origin] });
if (error) throw new Error(`Booking client could not be created: ${error.message}`);
process.stdout.write("Booking API client created. Copy the following key now; it will not be shown again.\n");
process.stdout.write(`${rawKey}\n`);
