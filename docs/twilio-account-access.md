# Private Twilio access for Le Yard's account audit

This branch supplies a READ-ONLY account check through the existing GitHub Actions
runner. It does not deploy the OS, buy numbers, change webhooks, send a message,
place a call, or submit/recreate a campaign. It is not evidence that service is live.

## Owner step

In the le-yard-os GitHub repository, open Settings > Environments > le-yard-phone.
The workflow references that environment; create it with that exact name if needed.
Add these two environment secrets directly in GitHub, NOT in chat, code, an issue,
a pull-request comment, a screenshot, or a committed env file:

- TWILIO_ACCOUNT_SID: the existing Le Yard Account SID from Twilio.
- TWILIO_AUTH_TOKEN: the account's Auth Token from Twilio, not a password or test token.

Restrict the environment to the ops/twilio-account-access branch and set yourself
as a required reviewer. Do not enable Prevent self-review when you are the only
reviewer, because you must be able to approve your own requested account check.
The job is restricted to the repository owner as original and rerun initiator.

After the secrets are saved, rerun the account-check job and approve it when GitHub
requests approval. A connected assistant can request the rerun through the GitHub
Actions tool; the secret itself remains in GitHub/the executing runner. The report
contains only selected non-secret status, not the Auth Token or guest messages.

A missing secret produces access=blocked and a failed check, rather than a false
success. Account/Profile approval is not proof that A2P campaign registration is
verified. The script reads the existing Le Yard Guest Care service and campaign.
It never creates replacements. Listings are bounded, and the output reports when
more pages exist rather than treating a partial result as complete inventory.

An Auth Token is powerful. Use this dedicated protected environment, review any
future workflow changes before approving jobs, and rotate/revoke it when appropriate.
API key separation and production webhook secrets should be configured before
service activation. This audit does not copy secrets into Vercel automatically.

Number: +1 332-877-9035. Phone-configuration implementation remains in PR #4 on
feature/twilio-comms. Maris's forwarding number and real-carrier tests are still
required before simultaneous-ring acceptance can be claimed.
