# ChatGPT Business GitHub plugin marketplace

Le Yard OS contains a repository-scoped plugin marketplace at `.agents/plugins/marketplace.json`. It is designed for the ChatGPT workspace GitHub import and for local Codex discovery from this repository.

Official OpenAI references:

- [Import and sync workspace plugins from GitHub](https://learn.chatgpt.com/docs/enterprise/plugin-management)
- [Package a plugin and define marketplace metadata](https://developers.openai.com/plugins/build/plugins)

## Import configuration

Use these values in **Admin > Plugins > Add > Import marketplace**:

| Field | Value |
| --- | --- |
| Source | `https://github.com/donaldlena833-cyber/le-yard-os` |
| Path | Leave empty; the marketplace is at the repository root |
| Branch, tag, or commit | `main` for continuing daily sync |

The GitHub account authorizing the import must be able to read this repository and any future repositories referenced by marketplace entries. OpenAI supports public and private GitHub repositories. A branch follows future commits; a fixed commit remains pinned.

After import, review the result and configure each plugin's workspace installation policy and eligible roles. Repository `policy` values support local discovery but do not set workspace policy during GitHub import.

## Initial catalog

| Plugin | Purpose | Suggested initial roles | Declared app access |
| --- | --- | --- | --- |
| `le-yard-vendor-research` | Evidence-led supplier research and quote comparison | Owner, Admin, Chef, Manager | None |
| `le-yard-menu-costing` | Auditable recipe and target-price costing | Owner, Admin, Chef | None |
| `le-yard-premises-admin` | Cited lease, permit, and filing control | Owner and specifically approved advisers | None |
| `le-yard-ops-reporting` | Source-aware OS briefs and report QA | Owner, Admin, Manager; Chef only when appropriate | None |
| `le-yard-marketing` | Approved-fact campaign and channel drafts | Owner and approved marketing roles | None |

Version `0.1.0` is skill-only. It declares no `.app.json` or `.mcp.json`, requests no connected-app permission, and does not create a live data path into Le Yard OS. Users can work from files or exports they are already authorized to access. This keeps the first rollout cloud-compatible and avoids the desktop-only classification that OpenAI applies to plugins containing MCP server configuration.

## Permission and data boundary

- Importing or syncing the marketplace does not grant app access, connect member accounts, or override service permissions. Enable required apps and roles separately if a later plugin version declares them.
- Keep least-privilege role assignments. Do not install the premises plugin broadly or expose owner financial, legal, employee, guest, or credential material to a role that does not already have that access.
- This GitHub repository is public. Plugin instructions, templates, tests, and synthetic fixtures may be committed; live leases, quotes, vendor messages, invoices, guest or staff data, credentials, tokens, and unpublished strategy may not.
- Marketplace sync is a distribution mechanism, not evidence that a plugin used an app, performed an action, or changed Le Yard OS.

## Change control

1. Change one plugin for one reviewable purpose and bump its semantic version.
2. Run `npm run test:plugins` and the normal repository verification appropriate to the change.
3. Review the diff for secrets, private business material, overbroad permissions, and unsafe action language.
4. Merge the reviewed change to `main`.
5. Allow the daily sync or use **Admin > Plugins > Marketplaces > Sync now**.
6. Review the saved sync report and verify the installed version and role policy.
7. Run at least one realistic starter prompt and confirm that missing evidence and consequential actions still fail closed.

If an update is invalid, OpenAI retains the last working version of an existing plugin and reports an error. Fix the repository and sync again; do not treat retention of the old version as a successful release. Removing an entry marks its workspace plugin as no longer in source rather than deleting it. Deleting the marketplace in ChatGPT removes the plugins imported from it.

Marketplace sync uses the GitHub connection of the admin who imported it. To transfer ownership, another workspace admin should import the same Source, Path, and Branch values with their own authorized GitHub connection. Do not delete the marketplace merely to reconnect it.

## Future connected access

Add an app only after its registered app ID, authentication design, tenant and role boundary, action controls, and acceptance evidence exist. Reference the approved ID through `.app.json`; never commit access tokens. Admins must then enable the app for the intended roles, and members must complete required authentication. Do not add `.mcp.json` casually: any imported plugin declaring MCP servers is currently desktop-only, including remote HTTPS servers.

## Acceptance gates

The marketplace is operational only when all of these are true:

- `.agents/plugins/marketplace.json` and every referenced plugin are present on the imported GitHub branch;
- `npm run test:plugins` and each official plugin validator pass;
- the workspace import result shows all expected plugin names and versions without errors;
- installation roles and app access have been reviewed separately for every plugin;
- a real workspace invocation follows its evidence and approval boundaries;
- the workspace sync report, not merely a Git commit, confirms the imported state.
