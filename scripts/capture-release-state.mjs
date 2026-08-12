import { execFileSync } from "node:child_process";

const root = process.cwd();
const run = (command, args) => execFileSync(command, args, { cwd: root, encoding: "utf8" }).trim();
const migrationFiles = run("find", ["supabase/migrations", "-maxdepth", "1", "-type", "f", "-name", "*.sql", "-print"]).split("\n").filter(Boolean).sort();
const migrationHead = migrationFiles.at(-1)?.match(/(\d{14})_/)?.[1] ?? null;
process.stdout.write(JSON.stringify({
  capturedAt: new Date().toISOString(),
  repository: { commitSha: run("git", ["rev-parse", "HEAD"]), branch: run("git", ["branch", "--show-current"]), dirty: Boolean(run("git", ["status", "--porcelain"])) },
  migrationHead,
  migrationCount: migrationFiles.length,
  flags: { publicBooking: process.env.RESERVATION_PUBLIC_BOOKING_ENABLED === "true", sms: process.env.RESERVATION_SMS_DELIVERY_ENABLED === "true", push: process.env.RESERVATION_PUSH_DELIVERY_ENABLED === "true" },
  note: "This artifact intentionally contains no credentials, URLs, tenant identifiers, or deployment secrets."
}, null, 2) + "\n");
