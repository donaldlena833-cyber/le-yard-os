import "server-only";

// Compatibility exports for callers that have not yet moved to the explicit
// emergency-gate names. A true value only means the emergency pause is open;
// database release control remains the sole positive booking authority.
export {
  assertPublicReservationEmergencyGateOpen as assertPublicReservationInventoryEnabled,
  isPublicReservationEmergencyGateOpen as isPublicReservationInventoryEnabled,
} from "./public-release-control.server";
