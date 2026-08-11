import "server-only";

export function reservationSmsDeliveryEnabled() {
  return process.env.RESERVATION_SMS_DELIVERY_ENABLED === "true";
}
