"use client";

import { useCallback, useState } from "react";

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const source = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(source)
      .sort()
      .filter((key) => source[key] !== undefined)
      .map((key) => [key, canonicalize(source[key])]),
  );
}

export function stablePayloadFingerprint(payload: unknown): string {
  return JSON.stringify(canonicalize(payload));
}

interface RequestEntry {
  fingerprint: string;
  requestId: string;
}

export class PayloadRequestRegistry {
  private readonly entries = new Map<string, RequestEntry>();

  constructor(private readonly createId: () => string = () => crypto.randomUUID()) {}

  requestId(scope: string, payload: unknown): string {
    const fingerprint = stablePayloadFingerprint(payload);
    const current = this.entries.get(scope);
    if (current?.fingerprint === fingerprint) return current.requestId;
    const requestId = this.createId();
    this.entries.set(scope, { fingerprint, requestId });
    return requestId;
  }

  rotate(scope: string): void {
    this.entries.delete(scope);
  }

  rotateAll(): void {
    this.entries.clear();
  }
}

export function useStableRequestIds() {
  const [registry] = useState(() => new PayloadRequestRegistry());
  const requestIdFor = useCallback(
    (scope: string, payload: unknown) => registry.requestId(scope, payload),
    [registry],
  );
  const rotateRequestId = useCallback((scope: string) => {
    registry.rotate(scope);
  }, [registry]);
  const rotateAllRequestIds = useCallback(() => {
    registry.rotateAll();
  }, [registry]);
  return { requestIdFor, rotateRequestId, rotateAllRequestIds };
}
