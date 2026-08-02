export const PRIVATE_BUCKETS = [
  "profile-avatars",
  "employee-documents",
  "chat-attachments",
  "receipts",
  "closeouts",
  "inventory",
  "sops",
  "incidents",
  "reports",
  "imports",
  "checklists",
] as const;

export type PrivateBucket = (typeof PRIVATE_BUCKETS)[number];
export type PrivateObjectPath = string & {
  readonly __privateObjectPath: unique symbol;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const safeSegmentPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const imageMimeTypes = ["image/jpeg", "image/png", "image/webp"] as const;
const documentMimeTypes = [
  ...imageMimeTypes,
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/json",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

export interface PrivateBucketPolicy {
  maxBytes: number;
  mimeTypes: readonly string[];
}

const mib = 1_048_576;

/** Exact private bucket configuration declared by the ordered SQL migrations. */
export const PRIVATE_BUCKET_DATABASE_POLICIES = {
  "profile-avatars": { maxBytes: 5 * mib, mimeTypes: imageMimeTypes },
  "employee-documents": { maxBytes: 25 * mib, mimeTypes: null },
  "chat-attachments": { maxBytes: 25 * mib, mimeTypes: null },
  receipts: {
    maxBytes: 50 * mib,
    mimeTypes: [...imageMimeTypes, "application/pdf"],
  },
  closeouts: { maxBytes: 25 * mib, mimeTypes: null },
  inventory: { maxBytes: 50 * mib, mimeTypes: null },
  sops: { maxBytes: 50 * mib, mimeTypes: null },
  incidents: { maxBytes: 50 * mib, mimeTypes: null },
  reports: { maxBytes: 50 * mib, mimeTypes: null },
  imports: { maxBytes: 100 * mib, mimeTypes: null },
  checklists: { maxBytes: 25 * mib, mimeTypes: imageMimeTypes },
} as const satisfies Record<
  PrivateBucket,
  { maxBytes: number; mimeTypes: readonly string[] | null }
>;

/**
 * App upload allowlists intentionally narrow buckets whose database MIME list
 * is NULL. Byte ceilings remain exactly at or below the database ceiling.
 */
export const PRIVATE_BUCKET_POLICIES: Record<PrivateBucket, PrivateBucketPolicy> = {
  "profile-avatars": {
    maxBytes: PRIVATE_BUCKET_DATABASE_POLICIES["profile-avatars"].maxBytes,
    mimeTypes: imageMimeTypes,
  },
  "employee-documents": {
    maxBytes: PRIVATE_BUCKET_DATABASE_POLICIES["employee-documents"].maxBytes,
    mimeTypes: documentMimeTypes,
  },
  "chat-attachments": {
    maxBytes: PRIVATE_BUCKET_DATABASE_POLICIES["chat-attachments"].maxBytes,
    mimeTypes: documentMimeTypes,
  },
  receipts: {
    maxBytes: PRIVATE_BUCKET_DATABASE_POLICIES.receipts.maxBytes,
    mimeTypes: [...imageMimeTypes, "application/pdf"],
  },
  closeouts: {
    maxBytes: PRIVATE_BUCKET_DATABASE_POLICIES.closeouts.maxBytes,
    mimeTypes: documentMimeTypes,
  },
  inventory: {
    maxBytes: PRIVATE_BUCKET_DATABASE_POLICIES.inventory.maxBytes,
    mimeTypes: documentMimeTypes,
  },
  sops: {
    maxBytes: PRIVATE_BUCKET_DATABASE_POLICIES.sops.maxBytes,
    mimeTypes: documentMimeTypes,
  },
  incidents: {
    maxBytes: PRIVATE_BUCKET_DATABASE_POLICIES.incidents.maxBytes,
    mimeTypes: documentMimeTypes,
  },
  reports: {
    maxBytes: PRIVATE_BUCKET_DATABASE_POLICIES.reports.maxBytes,
    mimeTypes: [
      "application/pdf",
      "text/csv",
      "application/json",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ],
  },
  imports: {
    maxBytes: PRIVATE_BUCKET_DATABASE_POLICIES.imports.maxBytes,
    mimeTypes: [
      "text/csv",
      "application/json",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ],
  },
  checklists: {
    maxBytes: PRIVATE_BUCKET_DATABASE_POLICIES.checklists.maxBytes,
    mimeTypes: PRIVATE_BUCKET_DATABASE_POLICIES.checklists.mimeTypes,
  },
};

export function isUuid(value: string): boolean {
  return uuidPattern.test(value);
}

export function normalizePrivateFileName(fileName: string): string {
  const normalized = fileName
    .normalize("NFKC")
    .replace(/[\\/]+/g, "-")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 180);
  return normalized || "private-file";
}

export interface PrivateFileValidation {
  ok: boolean;
  message?: string;
}

export function validatePrivateFile(
  bucket: PrivateBucket,
  mimeType: string,
  sizeBytes: number,
): PrivateFileValidation {
  const policy = PRIVATE_BUCKET_POLICIES[bucket];
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
    return { ok: false, message: "The file size is invalid." };
  }
  if (sizeBytes > policy.maxBytes) {
    return { ok: false, message: "The file exceeds this workspace's upload limit." };
  }
  if (!policy.mimeTypes.includes(mimeType)) {
    return { ok: false, message: "This file type is not allowed for that workspace." };
  }
  return { ok: true };
}

export function buildPrivateObjectPath({
  organizationId,
  locationId,
  resourceKind,
  resourceId,
  uploadId,
  fileName,
}: {
  organizationId: string;
  locationId: string | "global";
  resourceKind: string;
  resourceId: string;
  uploadId: string;
  fileName: string;
}): PrivateObjectPath {
  if (!isUuid(organizationId)) throw new Error("Invalid storage organization.");
  if (locationId !== "global" && !isUuid(locationId)) {
    throw new Error("Invalid storage location.");
  }
  if (!safeSegmentPattern.test(resourceKind)) {
    throw new Error("Invalid storage resource kind.");
  }
  if (!isUuid(resourceId) || !isUuid(uploadId)) {
    throw new Error("Invalid storage resource identifier.");
  }

  return [
    organizationId,
    locationId,
    resourceKind,
    resourceId,
    `${uploadId}-${normalizePrivateFileName(fileName)}`,
  ].join("/") as PrivateObjectPath;
}

export function buildAvatarObjectPath({
  organizationId,
  userId,
  mimeType,
}: {
  organizationId: string;
  userId: string;
  mimeType: (typeof imageMimeTypes)[number];
}): PrivateObjectPath {
  if (!isUuid(organizationId) || !isUuid(userId)) {
    throw new Error("Invalid avatar storage scope.");
  }
  const extension = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  }[mimeType];
  if (!extension) throw new Error("Invalid avatar file type.");
  return `${organizationId}/global/${userId}.${extension}` as PrivateObjectPath;
}

export interface ParsedPrivateObjectPath {
  organizationId: string;
  locationId: string | "global";
  segments: readonly string[];
}

export function parsePrivateObjectPath(
  objectPath: string,
): ParsedPrivateObjectPath | null {
  if (objectPath.length > 1_024 || objectPath.includes("\\") || objectPath.includes("%")) {
    return null;
  }
  const segments = objectPath.split("/");
  if (segments.length < 3 || segments.some((segment) => !safeSegmentPattern.test(segment))) {
    return null;
  }
  const [organizationId, locationId] = segments;
  if (!isUuid(organizationId)) return null;
  if (locationId !== "global" && !isUuid(locationId)) return null;

  return { organizationId, locationId, segments };
}
