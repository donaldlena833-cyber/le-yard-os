const POSTGRES_PROTOCOLS = new Set(["postgres:", "postgresql:"]);

function isLoopbackHostname(hostname) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized === "::1") return true;

  const octets = normalized.split(".");
  return (
    octets.length === 4 &&
    octets[0] === "127" &&
    octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)
  );
}

export function requireLocalPostgresControlUrl(value, environmentLabel) {
  if (!value) {
    throw new Error(
      `${environmentLabel} is required; this gate never falls back to PGlite.`,
    );
  }

  let controlUrl;
  try {
    controlUrl = new URL(value);
  } catch {
    throw new Error(`${environmentLabel} must be a valid PostgreSQL URL.`);
  }

  if (!POSTGRES_PROTOCOLS.has(controlUrl.protocol)) {
    throw new Error(`${environmentLabel} must be a valid PostgreSQL URL.`);
  }
  if (!isLoopbackHostname(controlUrl.hostname)) {
    throw new Error(
      `${environmentLabel} must target a loopback PostgreSQL cluster; shared and remote databases are refused.`,
    );
  }
  if (controlUrl.pathname !== "/postgres") {
    throw new Error(
      `${environmentLabel} must target the postgres control database on a loopback cluster.`,
    );
  }

  return controlUrl;
}
