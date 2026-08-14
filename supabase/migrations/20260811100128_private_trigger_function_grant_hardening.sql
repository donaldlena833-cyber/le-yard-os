-- Private helpers and trigger functions are never direct RPC surfaces.
-- PostgreSQL otherwise gives EXECUTE to PUBLIC when a function is created,
-- including SECURITY DEFINER functions in an unexposed schema. Freeze both
-- the restored catalog and future postgres-owned private functions closed.

alter default privileges for role postgres in schema private
  revoke execute on functions from public;

revoke execute on all functions in schema private
  from public, anon, authenticated, service_role;
