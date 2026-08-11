export const reservationProviderTimeoutMs = 10_000;
export const reservationMessageLeaseSeconds = 120;
export const reservationMessageClaimLimit = 8;

export function reservationMessageClaimIsLeaseSafe() {
  return (
    reservationMessageClaimLimit * reservationProviderTimeoutMs <=
    (reservationMessageLeaseSeconds * 1_000 * 2) / 3
  );
}
