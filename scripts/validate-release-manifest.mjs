import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const file = process.argv[2];
if (!file) throw new Error("Usage: node scripts/validate-release-manifest.mjs <manifest.json>");

const manifest = JSON.parse(await readFile(resolve(file), "utf8"));
const required = ["releaseId", "commitSha", "migrationHead", "projects", "flags", "approvals"];
for (const key of required) if (!(key in manifest)) throw new Error(`Missing release manifest field: ${key}`);
if (!/^[0-9a-f]{40}$/.test(manifest.commitSha)) throw new Error("commitSha must be a 40-character lowercase SHA");
if (!/^\d{14}$/.test(manifest.migrationHead)) throw new Error("migrationHead must be a 14-digit migration version");
for (const name of ["os", "site", "reserve", "host"]) {
  const deployment = manifest.projects[name];
  if (!deployment || !deployment.project || !deployment.commitSha || !deployment.deploymentId) {
    throw new Error(`projects.${name} must include project, commitSha, and deploymentId`);
  }
  if (!/^[0-9a-f]{40}$/.test(deployment.commitSha)) throw new Error(`projects.${name}.commitSha is invalid`);
}
for (const flag of ["publicBooking", "email", "sms", "push"]) {
  if (typeof manifest.flags[flag] !== "boolean") throw new Error(`flags.${flag} must be boolean`);
}
for (const approval of ["reviewed", "stagingAccepted", "managedRecoveryAccepted"]) {
  if (manifest.approvals[approval] !== true) throw new Error(`Release is not approved: ${approval}`);
}
if (manifest.flags.publicBooking && !manifest.flags.email) throw new Error("Public booking requires email delivery approval");
if (manifest.flags.sms) throw new Error("SMS remains disabled until its provider crash/replay gate is explicitly accepted");
if (manifest.flags.push) throw new Error("Push remains disabled until its provider acceptance gate is explicitly accepted");
process.stdout.write(JSON.stringify({ ok: true, releaseId: manifest.releaseId, commitSha: manifest.commitSha, migrationHead: manifest.migrationHead }) + "\n");
