#!/usr/bin/env node

import { randomBytes, scryptSync } from "node:crypto";

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const password = Buffer.concat(chunks).toString("utf8");

if (
  password.length < 10 ||
  password.length > 128 ||
  !/[A-Za-z]/.test(password) ||
  !/[0-9]/.test(password) ||
  /[\u0000-\u001f\u007f]/.test(password)
) {
  process.stderr.write(
    "Expected a 10–128 character password with at least one letter and number on standard input.\n",
  );
  process.exitCode = 1;
} else {
  const salt = randomBytes(16);
  const digest = scryptSync(password, salt, 64, {
    N: 16_384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  process.stdout.write(
    `scrypt-v1$${salt.toString("base64url")}$${digest.toString("base64url")}`,
  );
}
