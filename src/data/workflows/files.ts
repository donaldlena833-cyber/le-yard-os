import "server-only";

import { assertCondition, assertFound, throwDatabaseError } from "../errors";
import {
  requireLocationAccess,
  requireOrganizationAccess,
} from "../policy";
import type { WorkflowContext } from "../execute";
import type { PrivateFileDownloadInput } from "../schemas";
import {
  normalizePrivateFileName,
  parsePrivateObjectPath,
} from "@/lib/storage/private-files";

const SIGNED_DOWNLOAD_SECONDS = 60;

export async function createPrivateFileDownloadUrl(
  { supabase, actor }: WorkflowContext,
  input: PrivateFileDownloadInput,
) {
  const parsedPath = parsePrivateObjectPath(input.objectPath);
  assertCondition(
    parsedPath,
    "validation",
    "The private file path is malformed.",
  );

  requireOrganizationAccess(actor, parsedPath.organizationId);
  if (parsedPath.locationId !== "global") {
    requireLocationAccess(
      actor,
      parsedPath.organizationId,
      parsedPath.locationId,
    );
  }

  // Storage RLS performs the resource-level check (channel membership,
  // employee-document visibility, management scope, or terminal evidence).
  const { data, error } = await supabase.storage
    .from(input.bucket)
    .createSignedUrl(input.objectPath, SIGNED_DOWNLOAD_SECONDS, {
      download: input.downloadFileName
        ? normalizePrivateFileName(input.downloadFileName)
        : false,
    });
  if (error) throwDatabaseError(error, "The private file could not be opened.");
  const signed = assertFound(data, "The private download URL was not returned.");

  return {
    bucket: input.bucket,
    objectPath: input.objectPath,
    signedUrl: signed.signedUrl,
    expiresInSeconds: SIGNED_DOWNLOAD_SECONDS,
  };
}
