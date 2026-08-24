import { z } from "zod";
import {
  guestInterestVerificationTokenHash,
  parseGuestInterestVerificationToken,
} from "@/lib/guest-interest-verification.server";
import { createAdminClient } from "@/lib/supabase/admin";

const tokenSchema = z.string().min(64).max(2_000);

function noStore(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}

function html(value: string, status = 200) {
  return new Response(value, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/html; charset=utf-8",
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });
}

function parseToken(request: Request, body?: unknown) {
  const candidate = body && typeof body === "object"
    ? (body as { token?: unknown }).token
    : new URL(request.url).searchParams.get("token");
  return tokenSchema.parse(candidate);
}

async function readTokenBody(request: Request) {
  if (!request.body) throw new Error("missing_body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 4_096) {
      await reader.cancel("request_too_large");
      throw new Error("request_too_large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return (request.headers.get("content-type") ?? "").includes(
    "application/x-www-form-urlencoded",
  )
    ? { token: new URLSearchParams(text).get("token") }
    : JSON.parse(text);
}

export async function GET(request: Request) {
  try {
    const token = parseToken(request);
    const payload = parseGuestInterestVerificationToken(token);
    if (request.headers.get("accept")?.includes("text/html")) {
      return html(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Confirm your Le Yard email</title><body style="margin:0;background:#191b18;color:#fffdf7;font:16px Arial,sans-serif"><main style="max-width:560px;margin:10vh auto;padding:32px"><p style="letter-spacing:.16em;text-transform:uppercase;color:#cda76a">Le Yard</p><h1 style="font:42px Georgia,serif">Confirm your email</h1><p style="line-height:1.6;color:#d9d5ca">Confirm this address before we add your interests and email consent to the private guest list.</p><form method="post"><input type="hidden" name="token" value="${token}"><button style="margin-top:18px;padding:14px 20px;border:0;border-radius:8px;font-weight:700" type="submit">Confirm email</button></form><p style="margin-top:28px;font-size:13px;color:#aaa69d">This link expires ${payload.expiresAt}.</p></main></body></html>`);
    }
    return noStore({
      data: {
        status: "pending_confirmation",
        requestId: payload.requestId,
        expiresAt: payload.expiresAt,
      },
    });
  } catch {
    return noStore(
      { error: { code: "verification_unavailable", message: "This confirmation link is invalid or expired." } },
      400,
    );
  }
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  const formResponse = contentType.includes("application/x-www-form-urlencoded");
  let token: string;
  let payload: ReturnType<typeof parseGuestInterestVerificationToken>;
  try {
    const body = await readTokenBody(request);
    token = parseToken(request, body);
    payload = parseGuestInterestVerificationToken(token);
  } catch {
    return formResponse
      ? html("<!doctype html><html lang=\"en\"><title>Confirmation unavailable</title><body><h1>This confirmation link is invalid or expired.</h1></body></html>", 400)
      : noStore(
          { error: { code: "verification_unavailable", message: "This confirmation link is invalid or expired." } },
          400,
        );
  }
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("service_finalize_guest_interest", {
      p_request_id: payload.requestId,
      p_verification_token_hash: guestInterestVerificationTokenHash(token),
    } as never);
    if (error) throw new Error("verification_failed");
    if (formResponse) {
      return html(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email confirmed</title><body style="margin:0;background:#191b18;color:#fffdf7;font:16px Arial,sans-serif"><main style="max-width:560px;margin:10vh auto;padding:32px"><p style="letter-spacing:.16em;text-transform:uppercase;color:#cda76a">Le Yard</p><h1 style="font:42px Georgia,serif">You’re confirmed.</h1><p style="line-height:1.6;color:#d9d5ca">Your verified email and selected interests are now saved. We’ll keep you posted as opening approaches.</p></main></body></html>`);
    }
    return noStore({ data });
  } catch {
    return formResponse
      ? html("<!doctype html><html lang=\"en\"><title>Confirmation delayed</title><body><h1>We could not save this confirmation yet.</h1><p>Please try the same link again shortly.</p></body></html>", 503)
      : noStore(
          { error: { code: "verification_temporarily_unavailable", message: "Confirmation is temporarily unavailable. Try again shortly." } },
          503,
        );
  }
}
