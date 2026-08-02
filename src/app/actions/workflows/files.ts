"use server";

import { executeWorkflowAction } from "@/data/execute";
import { privateFileDownloadInputSchema } from "@/data/schemas";
import { createPrivateFileDownloadUrl } from "@/data/workflows/files";

export async function createPrivateFileDownloadUrlAction(input: unknown) {
  return executeWorkflowAction({
    operation: "private_file.create_download_url",
    schema: privateFileDownloadInputSchema,
    input,
    persists: false,
    run: createPrivateFileDownloadUrl,
  });
}
