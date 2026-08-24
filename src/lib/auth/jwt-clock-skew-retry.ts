type SupabaseErrorLike = {
  message?: string;
} | null;

type SupabaseResultLike = {
  error: SupabaseErrorLike;
};

export const JWT_CLOCK_SKEW_RETRY_DELAY_MS = 2_000;

export function isJwtIssuedAtFutureError(error: SupabaseErrorLike): boolean {
  return error?.message?.toLowerCase().includes("jwt issued at future") ?? false;
}

/**
 * Supabase Auth and the Data API are separate services. A token minted at the
 * very edge of a second can occasionally reach PostgREST before its local
 * clock considers the token's `iat` valid. Retry only that exact transient
 * rejection; every authorization, RLS, and membership failure still fails
 * closed without a retry.
 */
export async function retryJwtIssuedAtFuture<T extends SupabaseResultLike>(
  operation: () => PromiseLike<T>,
  options: {
    delayMs?: number;
    onRetry?: () => void;
  } = {},
): Promise<T> {
  const firstResult = await operation();
  if (!isJwtIssuedAtFutureError(firstResult.error)) return firstResult;

  options.onRetry?.();
  await new Promise((resolve) =>
    setTimeout(resolve, options.delayMs ?? JWT_CLOCK_SKEW_RETRY_DELAY_MS),
  );
  return operation();
}
