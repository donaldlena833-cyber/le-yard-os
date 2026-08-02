import { createHash } from "node:crypto";

const signatures: Record<string, readonly number[]> = {
  "application/pdf": [0x25, 0x50, 0x44, 0x46, 0x2d],
  "image/jpeg": [0xff, 0xd8, 0xff],
  "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
};

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return (
    bytes.length >= signature.length &&
    signature.every((value, index) => bytes[index] === value)
  );
}

/**
 * Verifies the small set of private document formats accepted by the app.
 * This prevents an upload's browser-provided MIME label from being treated as
 * proof of its contents; malware scanning remains a separate provider hook.
 */
export function hasExpectedFileSignature(
  bytes: Uint8Array,
  mimeType: string,
): boolean {
  if (mimeType === "image/webp") {
    return (
      startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
      bytes.length >= 12 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    );
  }

  const signature = signatures[mimeType];
  return Boolean(signature && startsWith(bytes, signature));
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
