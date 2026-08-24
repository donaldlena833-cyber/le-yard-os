revoke all on function public.service_claim_reservation_push_deliveries(
  uuid, integer, integer, timestamptz
) from public, anon, authenticated;
revoke all on function public.service_begin_reservation_push_delivery(
  uuid, uuid, timestamptz
) from public, anon, authenticated;
revoke all on function public.service_complete_reservation_push_delivery(
  uuid, uuid, text, text, timestamptz, integer, boolean, timestamptz
) from public, anon, authenticated;

grant execute on function public.service_claim_reservation_push_deliveries(
  uuid, integer, integer, timestamptz
) to service_role;
grant execute on function public.service_begin_reservation_push_delivery(
  uuid, uuid, timestamptz
) to service_role;
grant execute on function public.service_complete_reservation_push_delivery(
  uuid, uuid, text, text, timestamptz, integer, boolean, timestamptz
) to service_role;
