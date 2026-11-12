import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const memberSchema = z.strictObject({
  user_id: z.uuid().transform((value) => value.toLowerCase()),
  role: z.enum(["owner", "admin", "manager", "employee"]),
  job_code: z.enum(["COUNTER", "BARISTA", "PREP", "SHIFT_LEAD"]).optional(),
});

const configSchema = z.strictObject({
  supabaseUrl: z.url(),
  members: z.array(memberSchema).min(1).max(100).optional(),
  organizationId: z.uuid().optional(),
});

function readTargetOrigin(value) {
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && local)) ||
    url.username || url.password || url.pathname !== "/" || url.search || url.hash
  ) {
    throw new Error("Use an HTTPS Supabase project origin or an HTTP loopback origin.");
  }
  return url.origin;
}

async function main() {
  const { positionals: [action, ...extra], values } = parseArgs({
    allowPositionals: true,
    options: {
      config: { type: "string" },
      execute: { type: "boolean", default: false },
    },
  });
  if (!["provision", "activate", "suspend"].includes(action) || extra.length || !values.config) {
    throw new Error("Usage: npm run church-street -- <provision|activate|suspend> --config <file> [--execute]");
  }

  const config = configSchema.parse(JSON.parse(await readFile(values.config, "utf8")));
  const target = readTargetOrigin(config.supabaseUrl);
  const isProvision = action === "provision";
  if (isProvision) {
    if (!config.members || config.organizationId) {
      throw new Error("A provision configuration requires members and omits organizationId.");
    }
    if (!config.members.some((member) => member.role === "owner")) {
      throw new Error("An approved owner is required.");
    }
    if (new Set(config.members.map((member) => member.user_id)).size !== config.members.length) {
      throw new Error("Roster accounts must be unique.");
    }
  } else if (!config.organizationId || config.members) {
    throw new Error("An activation or suspension configuration requires organizationId and omits members.");
  }

  const plan = {
    action,
    target,
    ...(isProvision ? { members: config.members, initialStatus: "suspended" } : { organizationId: config.organizationId }),
  };
  if (!values.execute) {
    console.log(JSON.stringify({ dryRun: true, ...plan }, null, 2));
    return;
  }

  const configuredOrigin = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!configuredOrigin || readTargetOrigin(configuredOrigin) !== target || !serviceKey) {
    throw new Error("SUPABASE_URL must match the reviewed target and SUPABASE_SERVICE_ROLE_KEY must be set.");
  }

  const supabase = createClient(target, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = isProvision
    ? await supabase.rpc("service_provision_church_street", { p_members: config.members })
    : await supabase.rpc("service_set_church_street_active", {
      p_organization_id: config.organizationId,
      p_active: action === "activate",
    });
  if (error) throw new Error(`Church Street ${action} failed (${error.code}): ${error.message}`);
  console.log(JSON.stringify({ action, target, result: data }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
