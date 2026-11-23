import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !secret || !publishable) throw new Error("Operations server environment is required.");
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const admin = createClient(url, secret, options);
const bucket = "music-connections";
const existing = await admin.storage.getBucket(bucket);
if (existing.error) {
  if (!/not found|does not exist/i.test(existing.error.message)) throw new Error("Music storage could not be checked.");
  const created = await admin.storage.createBucket(bucket, { public: false, fileSizeLimit: 20000, allowedMimeTypes: ["application/octet-stream"] });
  if (created.error) throw new Error("Music storage could not be created.");
}
const verified = await admin.storage.getBucket(bucket);
if (verified.error || verified.data.public || verified.data.file_size_limit !== 20000) throw new Error("Music storage privacy or size limit is incorrect.");
const fixturePath = `__readiness/${randomUUID()}.bin`;
try {
  const upload = await admin.storage.from(bucket).upload(fixturePath, Buffer.from("synthetic-private-storage-readiness"), { contentType: "application/octet-stream", upsert: false });
  if (upload.error) throw new Error("Music storage write check failed.");
  const privateRead = await admin.storage.from(bucket).download(fixturePath);
  if (privateRead.error || await privateRead.data.text() !== "synthetic-private-storage-readiness") throw new Error("Music storage read check failed.");
  const anonymous = createClient(url, publishable, options);
  const forbidden = await anonymous.storage.from(bucket).download(fixturePath);
  if (!forbidden.error || forbidden.data) throw new Error("Music storage unexpectedly allowed anonymous access.");
  const metadata = await admin.from("integration_connections").select("id").eq("provider", "other")
    .eq("adapter_version", "spotify-music-v1").eq("configuration", JSON.stringify({ clientId: "readiness-only" })).limit(1);
  if (metadata.error) throw new Error("Music metadata compare-and-set filter is unavailable.");
  console.log(JSON.stringify({ privateBucket: true, fileSizeLimit: 20000, serviceReadWrite: true, anonymousReadDenied: true, metadataFilter: true }));
} finally {
  const removed = await admin.storage.from(bucket).remove([fixturePath]);
  if (removed.error) throw new Error("Synthetic music storage check needs cleanup.");
}
