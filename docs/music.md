# Church Street music

The owner/admin music panel lives on the main Today dashboard at `/today#music`. `/music` redirects there; OAuth also returns to the dashboard. It reads the current Spotify session, shows the uniquely named **Le Yard** speaker, plays a selected playlist or resumes its existing context, pauses it and sets volume. A visible inactive target is activated first, then verified before playback. Every command re-discovers the device and uses its explicit ID. A playing session on another device is never transferred. Duplicate names and restricted devices fail closed. A successful command response is separate from a verified post-command state.

## Current schedule

The dashboard saves enabled state, New York start/end times, selected start weekdays, starting volume, and an optional Spotify playlist in the existing server-only connection metadata. Overnight hours stop on the following day. Empty playlists resume the existing context. Saving applies future boundaries; Play starts immediately. Refreshing a token preserves schedule settings and runner state.

Supabase pg_cron invokes the Operations internal endpoint every minute using pg_net and a dedicated bearer secret in Vault. Set `MUSIC_SCHEDULER_SECRET` in the Operations production environment and the matching `le_yard_music_scheduler_v1` Vault secret, then install `scripts/music-schedule-cron.sql`. No schema change or compatibility release is needed. The endpoint accepts no tenant/device selection and resolves only the active Church Street tenant and location.

The runner acquires a 90-second metadata compare-and-set lease, deduplicates local calendar boundaries (including repeated DST minutes), and retries unconfirmed commands every two minutes up to five attempts. Morning starts expire after 15 minutes; late stops remain eligible until the next start boundary. Manual pauses are preserved after a completed start. A currently playing target keeps its session when a start is retried. The dashboard shows the last command result and a heartbeat updated every five minutes. Other active devices are never interrupted.

After the hosted heartbeat and real playback have been verified, pause the two legacy local Codex automations (`le-yard-morning-music` and `le-yard-evening-music-stop`) to avoid conflicting schedules. The hosted runner does not depend on the Mac or an open page. The Echo still needs a reachable Spotify Connect session; the integration cannot power on unreachable hardware.

## Connection setup

The ChatGPT Spotify connection is not reused or exported. Register an Operations app at `https://developer.spotify.com/dashboard` and add this exact redirect URI:

`https://operations.leyardny.com/api/workspace/music/callback`

The requested Web API scopes are only `user-read-playback-state` and `user-modify-playback-state`. An owner supplies the app's public client ID on Music and authorizes their Spotify account. The app uses authorization-code PKCE; it does not request a client secret, password, profile email or library access. Spotify may require Premium and allowlisting the account for a development-mode app. The developer terms require owner acceptance; no acceptance is implied by deploying this page.

Set server-only `MUSIC_TOKEN_ENCRYPTION_KEY` to a fresh base64 32-byte key before enabling the connection. Never use a `NEXT_PUBLIC_` variable for this key. Keep a secure recovery copy; changing it requires reconnecting Spotify. Run `node --env-file=/private/path/operations.env scripts/setup-music-storage.mjs` to create and verify the private `music-connections` bucket (20 KB limit, application/octet-stream, no staff or anonymous policies). Apply the additive music migration and deploy the matching runtime schema contract to Operations, Host, and Phone together.

The dedicated server-only `music_connections` table holds one row for the scoped location. Church Street deliberately blocks the legacy integration module, which remains unchanged. It contains client ID, encrypted-file version, refresh lease, schedule settings and the last runner result; no token or ciphertext is copied into the row or its audit history. Anonymous and staff roles cannot directly read or write these records. The token file is accessible only through the server service role after the route verifies the authenticated Church Street owner/admin scope using user-scoped RLS reads. No track-history database is created.

OAuth state is encrypted, expires after ten minutes, uses a Secure/HttpOnly/SameSite=Lax host cookie and is bound to the initiating user, organization and location. The callback rechecks authorization, removes the state cookie and discards provider error bodies. Grants are encrypted with AES-256-GCM and organization/location associated data. Refresh uses a compare-and-set lease on music metadata to prevent concurrent token rotation. New encrypted versions are uploaded before a metadata compare-and-set; failed commits clean their own orphan file and successful commits remove only their exact previous version. Disconnect disables the record before removing current/obsolete scoped files and deleting the metadata row. Cleanup failures remain retryable. Disconnect also removes the saved schedule; Alexa itself is unaffected. Revoke the app in Spotify account settings to remove provider-side authorization too.

## Verification and activation

Unit checks cover account/tenant boundary, CSRF and input limits, encrypted custody and state expiry, metadata races and orphan cleanup, scoped disconnect, duplicate/restricted target handling, other-device isolation, uncertain command results and stale UI clearing. The storage setup script verifies service-role read/write, anonymous read rejection and metadata JSON filtering using a clearly labeled synthetic file, then removes it. Browser acceptance must additionally complete OAuth, verify a real read from the speaker, and test an authorized volume change. Neither a deployed Music page nor successful mocks establishes a connected Spotify account.

Spotify's personal plans are not licensed for public music in a restaurant. A customer-facing business-music setup needs an appropriately licensed provider and compatible player; this integration does not supply performance rights.
