# Church Street music

The owner/admin Music page lives at `/music` on the Operations surface. It reads the current Spotify session, shows the uniquely named **Le Yard** speaker, resumes its existing context, pauses it and sets volume. Every command re-discovers the device and uses its explicit ID. A playing session on another device is never transferred. Duplicate names and restricted devices fail closed. A successful command response is separate from a verified post-command state.

## Current schedule

Daily, 06:30–17:00, `America/New_York`, morning volume 85%; playlists are deferred. The two existing **Codex** automations continue to own this schedule. The page displays the agreed settings and clearly says it does not verify automation execution. No Vercel cron, Supabase schedule or duplicate worker is installed. The Mac must remain available for those local automations. Resume can fail if Spotify no longer has a reachable retained session.

## Connection setup

The ChatGPT Spotify connection is not reused or exported. Register an Operations app at `https://developer.spotify.com/dashboard` and add this exact redirect URI:

`https://operations.leyardny.com/api/workspace/music/callback`

The requested Web API scopes are only `user-read-playback-state` and `user-modify-playback-state`. An owner supplies the app's public client ID on Music and authorizes their Spotify account. The app uses authorization-code PKCE; it does not request a client secret, password, profile email or library access. Spotify may require Premium and allowlisting the account for a development-mode app. The developer terms require owner acceptance; no acceptance is implied by deploying this page.

Set server-only `MUSIC_TOKEN_ENCRYPTION_KEY` to a fresh base64 32-byte key before enabling the connection. Never use a `NEXT_PUBLIC_` variable for this key. Keep a secure recovery copy; changing it requires reconnecting Spotify. Apply `20261123190628_church_music_connection.sql` and regenerate database types. The isolated table has forced RLS and no grants to `PUBLIC`, `anon` or `authenticated`; only the server service role can access it after the route verifies the authenticated Church Street owner/admin scope using user-scoped RLS reads. No track-history database is created.

OAuth state is encrypted, expires after ten minutes, uses a Secure/HttpOnly/SameSite=Lax host cookie and is bound to the initiating user, organization and location. The callback rechecks authorization, removes the state cookie and discards provider error bodies. Grants are encrypted with AES-256-GCM and organization/location associated data. Refresh uses a compare-and-set lease to prevent concurrent token rotation. Disconnect deletes the stored grant; Alexa and the separate Codex automation are unaffected. Revoke the app in Spotify account settings to remove provider-side authorization too.

## Verification and activation

Unit checks cover account/tenant boundary, CSRF and input limits, encrypted custody and state expiry, grant table privileges, duplicate/restricted target handling, other-device isolation, uncertain command results and stale UI clearing. Browser acceptance must additionally complete OAuth, verify a real read from the speaker, and test an authorized volume change. Neither a deployed Music page nor successful mocks establishes a connected Spotify account.

Spotify's personal plans are not licensed for public music in a restaurant. A customer-facing business-music setup needs an appropriately licensed provider and compatible player; this integration does not supply performance rights.
