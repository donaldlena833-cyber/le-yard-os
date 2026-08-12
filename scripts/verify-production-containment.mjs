const required = {
  VERCEL_ENV: "production",
  LE_YARD_PLAYGROUND_MODE: "production-playground",
  NEXT_PUBLIC_DEMO_MODE: "true",
};

for (const [name, expected] of Object.entries(required)) {
  if (process.env[name] !== expected) throw new Error(`${name} is not the required production-playground value.`);
}

for (const name of [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
]) {
  if (process.env[name]?.trim()) throw new Error(`${name} must be absent from the synthetic production playground.`);
}

for (const name of ["LE_YARD_PLAYGROUND_SESSION_SECRET", "LE_YARD_PLAYGROUND_USERS_JSON"]) {
  if (!process.env[name]?.trim()) throw new Error(`${name} is required for the synthetic production playground.`);
}

process.stdout.write("Production containment contract passed: synthetic playground with no Supabase configuration.\n");
