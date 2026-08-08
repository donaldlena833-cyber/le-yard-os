# Le Yard OS — Mateo and Irini interface audit

Audit date: 2026-08-08  
Environment: connected production deployment at `https://le-yard-os.vercel.app`  
Tenant shown: Le Yard · Le Yard  
Viewports: desktop (1440 × 1000) and mobile (390 × 844)  
Audit type: read-only end-to-end UI and role-configuration audit

This document records what was observed while using the application as Mateo (Chef) and Irini (Server). It is an evidence map, not a remediation plan. No source code, database records, schedules, messages, time entries, availability events, or operational records were changed during this audit.

## Remediation status

The actionable authorization and interface findings from this audit were addressed in the Version 0.2 release pass:

- F-01, F-02, and F-17: the Chef role now receives persisted operational capability defaults, including Kitchen, inventory, vendors, recipes, scheduling, service availability, and operational reports. Existing recognized Chef roles were backfilled without adding operational records.
- F-03 and F-04: the mobile bar now contains four role-prioritized destinations plus More, with extra safe-area content clearance. Mateo receives Today, Schedule, Kitchen, and Messages. Irini receives Today, Schedule, Messages, and Earnings.
- F-05, F-06, F-14, and F-18: direct workspace routes now use the same navigation permission model. Employee administration/intelligence routes and Chef people/pay routes return to Today before loading restricted content.
- F-13: Manager Log is no longer rendered to sessions without `manager_log.manage`; employees retain realtime availability and published pre-shift access.
- F-07 through F-12 and F-16 describe intentionally empty connected data or confirmed working role behavior. They required no synthetic data insertion.
- Live acceptance exposed and resolved a final session-boundary defect: PostgREST returned the single-column capability RPC as `{ capability_key }` rows while the generated client type described `string[]`. The session loader now normalizes both representations, so persisted Chef grants reach navigation and route guards.

The release does not populate vendors, recipes, inventory, shifts, earnings, messages, pre-shifts, manager logs, or availability events.

## Scope and method

1. Opened the deployed sign-in page.
2. Signed in as Mateo with the supplied Chef account and inspected the desktop and mobile Today experience.
3. Followed the visible kitchen, service, team, money, operations, and direct-route surfaces available to Mateo.
4. Opened Mateo’s mobile navigation drawer and confirmed the visible module list.
5. Logged out through the application UI.
6. Signed in as Irini with the supplied employee account and inspected the desktop and mobile Today experience.
7. Opened Irini’s mobile navigation drawer and inspected the bottom navigation, drawer, schedule, service control, time clock, earnings, messages, tasks, and management-gated routes.
8. Opened the command palette and notifications panel as Irini.
9. Logged out through the application UI.
10. Checked browser console output for both sessions; no console errors were reported.

Actions intentionally not performed: clock in/out, create or edit a record, publish a schedule, acknowledge a pre-shift, send a message, post an availability event, create a task, create a guest, upload a file, or run an Ask Le Yard query.

## Configuration evidence

The connected tenant was inspected read-only after the UI walkthrough:

| User | Organization role | Job role | Department | Location | Active |
|---|---|---|---|---|---|
| Mateo | Manager | Chef (`CHEF`) | Back of house | Le Yard | Yes |
| Irini | Employee | Server (`SERVER`) | Front of house | Le Yard | Yes |

The active job-role capability grant count was zero for every inspected job role, including Chef and Server. The inspected roles were Bartender, Chef, Owner operator, Server, and Support staff. This is the configuration fact that correlates with Mateo’s kitchen/inventory access state; it is not inferred from styling.

## Confirmed findings

### F-01 — Mateo’s Chef persona resolves to an unavailable Kitchen workspace

Severity: Critical for Chef workflow  
Evidence: `mateo-kitchen-desktop.png`; Mateo `/kitchen`, `/inventory`, and `/vendors` snapshots

- Mateo can sign in successfully and is shown as `Manager · Chef` in the workspace.
- Mateo’s Today hero says `Kitchen view · Le Yard` and describes back-of-house schedule, recipes, vendor pricing, and kitchen messages.
- The primary desktop navigation contains Today, Schedule, Service Control, Time Clock, Messages, and Tasks & SOPs. It does not contain Kitchen, Inventory, Vendors, or Recipes.
- The mobile More drawer contains the same non-kitchen module set. It does not contain Kitchen, Inventory, Vendors, or Recipes.
- The Today `Recipes & portion cost` and `Vendors & prices` cards are visible and link into kitchen surfaces.
- Direct `/kitchen` renders `Inventory unavailable` with `A kitchen or inventory capability is required at this location.`
- Direct `/inventory` renders the same unavailable state.
- Direct `/vendors` renders the same unavailable state.
- The current database role assignment identifies Mateo as an active Chef at the Le Yard location, while the inspected active capability grant count for the Chef job role is zero.

The result is a split state: Mateo is presented as a kitchen user on Today, but the linked authoring surfaces are unavailable and the navigation does not expose them.

![Mateo Kitchen unavailable](/Users/donaldlena/Documents/New project/le-yard-os/output/playwright/user-audit/mateo-kitchen-desktop.png)

### F-02 — Mateo’s kitchen action cards point to a blocked destination

Severity: High  
Evidence: `mateo-today-desktop.png`

- Today includes a `Kitchen tools` section.
- `Recipes & portion cost` and `Vendors & prices` are presented as actionable cards.
- The destination of each card displays an unavailable state for the same signed-in Chef.
- The cards therefore do not represent an end-to-end usable workflow for this role in the current connected tenant.

### F-03 — Mobile bottom navigation overlays page content

Severity: High at the tested mobile viewport  
Evidence: `mateo-today-mobile.png`, `irini-today-mobile.png`, `irini-service-mobile.png`, `irini-messages-all-staff-mobile.png`

- The fixed bottom bar is rendered as two entries: Today and More.
- On Mateo Today, the bar sits across the lower Kitchen tools content; the section continues behind or immediately below the fixed bar.
- On Irini Today, the bar cuts through the Published shifts region while additional page content remains below it.
- On Irini Service Control, the bar interrupts the lower Pre-shift section and leaves the page visually split between content above and below the navigation.
- On Irini Messages, the conversation composer/help area is partially hidden by the same fixed bar in the captured viewport.
- This is a visual and scanning problem independent of permissions; it is reproducible at 390 × 844.

![Irini Today mobile](/Users/donaldlena/Documents/New project/le-yard-os/output/playwright/user-audit/irini-today-mobile.png)

### F-04 — Irini’s lower navigation is a compressed entry point rather than a full module navigation

Severity: Medium  
Evidence: `irini-today-mobile.png`, `irini-mobile-navigation-open.png`

- The persistent mobile navigation shows only `Today` and `More`.
- Schedule, Service Control, Time Clock, Messages, Earnings, and Tasks & SOPs are only visible after opening More.
- The drawer is a large modal surface over the page and includes the employee profile and Log out controls.
- No Kitchen, Inventory, Vendors, Guests, Reports, Settings, or management-only destinations appear in the employee drawer.
- The desktop sidebar exposes the full employee list directly, while the mobile layout hides it behind More.

![Irini mobile navigation drawer](/Users/donaldlena/Documents/New project/le-yard-os/output/playwright/user-audit/irini-mobile-navigation-open.png)

### F-05 — Unauthorized-route handling is inconsistent across employee direct URLs

Severity: High  
Evidence: Irini route walkthrough

Observed behavior as Irini:

| Direct route | Observed result |
|---|---|
| `/kitchen` | Blocked page: `Inventory unavailable` |
| `/inventory` | Blocked page: `Inventory unavailable` |
| `/vendors` | URL resolves back to `/today`, showing employee Today instead of an unavailable-state page |
| `/guests` | `Guestbook unavailable` / management access required |
| `/closeout` | `Closeout unavailable` / management access and tenant-scoped financial records required |
| `/reports` | `Report unavailable` / management access required |
| `/receipts` | `Invoices` / management access required |
| `/integrations` | `Integration records unavailable` / management access required |
| `/settings` | Tenant administration page renders; see F-06 |

The same class of employee access attempt therefore produces a blocked state, a redirect to Today, or a fully rendered administration page depending on the route.

### F-06 — Employee direct access renders tenant administration content

Severity: High for role-boundary review  
Evidence: Irini `/settings` snapshot

- Irini is not shown Settings in the primary navigation or mobile drawer.
- Navigating directly to `/settings` renders `Tenant administration`.
- The page exposes organization and location setup language, capability section, expense categories, Security, Notifications, Data & audit, owner account names, role-boundary counts, AAL/session state, and retention status.
- The visible initial state contained no write action in the Organization section, but the tenant-level administration surface and internal setup metadata were rendered to the Employee session.
- No claim is made here about database mutation ability; only the rendered surface was verified.

### F-07 — Mateo’s role-specific Today and actual schedule data do not agree

Severity: Medium  
Evidence: Mateo `/today` and `/schedule` snapshots

- Mateo Today identifies the page as a kitchen view and says only kitchen roles are shown in the kitchen schedule card.
- The kitchen schedule card shows `0` shifts and `No kitchen shifts published today`.
- Mateo `/schedule` is a Service page with Draft status and controls for Add shift, Save template, and Publish.
- The visible schedule contains one Maris Bego Owner operator shift on Saturday Aug 8 from 4:00 PM to 10:00 PM; no BOH shift was present in the tested view.
- This leaves the Chef-facing kitchen schedule area empty while the broader schedule contains a FOH/owner shift.

### F-08 — Time Clock is reachable for both roles but has no configured policy context

Severity: Medium  
Evidence: `irini-time-clock-mobile.png`; Mateo and Irini `/time-clock` snapshots

- Both users can reach Time Clock without a redirect.
- Mateo is shown with job code `Chef`; Irini is shown with job code `Server`.
- Both screens show `Unscheduled punch` as the selected shift and an enabled Clock in action.
- Both screens show zero clocked-in and on-break records and no punch history.
- Both screens state that owner labor, break, and overtime policies are not configured, so the screen records facts without applying a legal or payroll threshold.
- No clock-in or clock-out was performed, so the write path and resulting audit entry were not tested.

![Irini Time Clock](/Users/donaldlena/Documents/New project/le-yard-os/output/playwright/user-audit/irini-time-clock-mobile.png)

### F-09 — Employee Today is correctly restricted to employee-facing information, but the connected tenant is empty

Severity: Medium (data coverage)  
Evidence: `irini-today-desktop.png`, `irini-today-mobile.png`

Irini’s Today page contains:

- Open shifts & swaps priority card.
- Published shifts card.
- Earnings card.
- Team announcements/messages card.

All four areas are empty in the connected tenant:

- No open shifts.
- No published shift assigned to Irini today.
- No paystub or estimated earnings.
- No announcements.

This means the employee dashboard’s empty-state and role framing were exercised, but a populated employee workflow was not available to verify.

![Irini Today desktop](/Users/donaldlena/Documents/New project/le-yard-os/output/playwright/user-audit/irini-today-desktop.png)

### F-10 — Employee Earnings renders correctly as a private empty state

Severity: Low (empty tenant state)  
Evidence: `irini-earnings-mobile.png`

- Page label is `Private to you`.
- Status is `Awaiting approved records`.
- Empty state says `No paystubs yet` and explains that approved Toast hours and manager-approved tip runs populate Friday paystubs.
- No amount is estimated.
- No paystub detail or daily earnings table was available to exercise.

![Irini Earnings](/Users/donaldlena/Documents/New project/le-yard-os/output/playwright/user-audit/irini-earnings-mobile.png)

### F-11 — Employee Messages membership is scoped differently from Mateo’s

Severity: Medium (workflow coverage)  
Evidence: `irini-messages-all-staff-mobile.png`; Mateo and Irini message snapshots

- Irini sees `4 people · 2 channels`: All Staff and Le Yard.
- Irini does not see the Management channel.
- All Staff opens to `Start the conversation`, with an empty transcript and a disabled Send message button until text is entered.
- Mateo sees `4 people · 3 channels`, including Management.
- No message was sent, so persistence, cross-session delivery, attachment handling, and realtime receipt were not verified.

![Irini All Staff message view](/Users/donaldlena/Documents/New project/le-yard-os/output/playwright/user-audit/irini-messages-all-staff-mobile.png)

### F-12 — Employee task restriction and manager task access are visibly different

Severity: Low (observed role distinction)  
Evidence: Irini and Mateo `/tasks` snapshots

- Irini sees `Staff controls`, a search field, and `Management has not assigned work in this location scope`.
- Irini does not see Create task or New task controls.
- Mateo sees `Management controls` and both Create task and New task controls.
- No task was created, so the complete assignment/completion flow remains untested.

### F-13 — Employee service-control surface is reachable but empty and contains manager-oriented sections

Severity: Medium  
Evidence: `irini-service-mobile.png`; Irini `/service` snapshot

- Irini can open Service Control from the mobile drawer and desktop sidebar.
- The page exposes Live availability, Manager Log, and Pre-shift cards.
- All three are empty in the connected tenant; no action record is present.
- The mobile page is affected by the bottom navigation overlap documented in F-03.
- No availability event, log entry, or pre-shift acknowledgement was created or tested.

![Irini Service Control](/Users/donaldlena/Documents/New project/le-yard-os/output/playwright/user-audit/irini-service-mobile.png)

### F-14 — Employee can reach Ask Le Yard directly despite it not being in employee navigation

Severity: Medium (route exposure and coverage)  
Evidence: `irini-search-open.png`; Irini `/assistant` snapshot

- Direct `/assistant` renders `Ask Le Yard · employee`.
- The page includes a query field, four suggested questions, deterministic cited-evidence language, and safety cards.
- Ask Le Yard is not listed in Irini’s desktop sidebar, mobile drawer, or command palette.
- No query was submitted; sensitive-answer filtering, citation content, freshness labels, and proposal behavior were not verified.

### F-15 — Irini command palette is permission-scoped to employee workspaces

Severity: Confirmed working behavior  
Evidence: `irini-search-open.png`

- The command menu opens from the desktop Search control.
- The visible workspace list is Today, Schedule, Service Control, Time Clock, Messages, Earnings, and Tasks & SOPs.
- No Kitchen, Inventory, Vendors, Guests, Reports, Settings, or management action is listed.
- No command was executed from the palette.

![Irini command palette](/Users/donaldlena/Documents/New project/le-yard-os/output/playwright/user-audit/irini-search-open.png)

### F-16 — Notification panel is functional but empty

Severity: Confirmed working behavior  
Evidence: `irini-notifications-open.png`

- The notification button opens a modal panel titled `Notifications`.
- The panel says `You’re caught up` and `No notifications`.
- The panel closes through Close notifications.
- No notification data existed for the session, so realtime notification arrival and acknowledgement were not tested.

![Irini notifications](/Users/donaldlena/Documents/New project/le-yard-os/output/playwright/user-audit/irini-notifications-open.png)

### F-17 — Mateo manager pages expose management controls while kitchen management is unavailable

Severity: High for role coherence  
Evidence: Mateo `/schedule`, `/tasks`, `/team`, `/guests`, `/service`, and `/kitchen` snapshots

- Mateo can see schedule mutation controls (Add shift, Save template, Publish).
- Mateo can see task-creation controls.
- Mateo can see the Team directory and employee profile sections.
- Mateo can see Guestbook and Add guest.
- Mateo can see Service Control cards.
- Mateo cannot access Inventory, Vendors, or Kitchen authoring from the same session.
- The role therefore has broad management UI in some domains and an unavailable state in the kitchen domain.

### F-18 — Mateo Team profile view displays private-profile controls in the tested manager session

Severity: Medium for role-boundary review  
Evidence: Mateo `/team` snapshot

- Mateo opens the Team directory and selects Donald’s profile.
- The profile contains private employee fields and visible controls labelled Add rule, Add certification, Upload, and Add contact.
- No edit was made and the underlying authorization of these controls was not tested.

## Route coverage matrix

### Mateo (Manager / Chef / BOH)

| Surface | Result |
|---|---|
| Sign in | Successful; landed on `/today` |
| Today | Kitchen-oriented home; empty kitchen schedule/messages; kitchen action cards visible |
| Kitchen | Rendered unavailable capability state |
| Inventory | Rendered unavailable capability state |
| Vendors | Rendered unavailable capability state |
| Schedule | Rendered Service schedule with Add shift, Save template, Publish; one owner shift visible |
| Service Control | Rendered live availability, manager log, pre-shift cards; no records |
| Time Clock | Rendered Chef job code, unscheduled punch, Clock in; no entries |
| Messages | Rendered three channels including Management |
| Tasks & SOPs | Rendered Management controls and task-create controls |
| Team | Rendered directory and employee profile view |
| Guests | Rendered Guestbook and Add guest |
| Earnings | Rendered private empty earnings state |
| Mobile navigation | More drawer omitted Kitchen/Inventory/Vendors/Recipes |
| Log out | Successful; returned to `/sign-in` |

### Irini (Employee / Server / FOH)

| Surface | Result |
|---|---|
| Sign in | Successful; landed on `/today` |
| Today | Employee home; open shifts, published shifts, earnings, announcements all empty |
| Schedule | Employee read-only empty schedule; no shifts visible |
| Service Control | Empty availability, manager log, pre-shift cards |
| Time Clock | Server job code, unscheduled punch, Clock in; no entries |
| Messages | Two channels; Management absent; empty All Staff conversation |
| Earnings | Private empty paystub state |
| Tasks & SOPs | Staff controls; no create-task action |
| Kitchen | Blocked inventory capability state |
| Inventory | Blocked inventory capability state |
| Vendors | Redirected to `/today` |
| Guests | Management-gated unavailable state |
| Closeout | Management-gated unavailable state |
| Reports | Management-gated unavailable state |
| Receipts | Management-gated unavailable state |
| Integrations | Management-gated unavailable state |
| Settings | Tenant administration page rendered on direct URL |
| Assistant | Ask Le Yard rendered on direct URL |
| Command palette | Employee workspaces only |
| Notifications | Panel opens; empty |
| Mobile navigation | Today/More fixed bar; full employee module list in drawer |
| Log out | Successful; returned to `/sign-in` |

## Visual and accessibility observations

- Typography is readable at both tested viewports, with strong large headings and clear section labels.
- Desktop sidebar grouping is visually consistent for the two roles tested, but the module availability differs sharply from the role-specific copy on Mateo’s Today page.
- Mobile touch targets for the header, More drawer, cards, and bottom navigation are visibly large enough to tap in the tested screenshots.
- The fixed mobile navigation’s content overlap is the confirmed visual layout defect.
- Notifications and command menu use modal surfaces with visible close/escape affordances in the tested desktop flow.
- No screen-reader audit, keyboard-only navigation audit, color-contrast measurement, reduced-motion audit, zoom audit, or physical-device testing was performed.
- No offline/slow-network behavior was tested.

## Evidence files

Screenshots from this run are stored at:

`/Users/donaldlena/Documents/New project/le-yard-os/output/playwright/user-audit/`

Files:

- `mateo-kitchen-desktop.png`
- `mateo-today-desktop.png`
- `mateo-today-mobile.png`
- `irini-today-desktop.png`
- `irini-today-mobile.png`
- `irini-mobile-navigation-open.png`
- `irini-time-clock-mobile.png`
- `irini-earnings-mobile.png`
- `irini-messages-all-staff-mobile.png`
- `irini-service-mobile.png`
- `irini-search-open.png`
- `irini-notifications-open.png`

## Limits of this audit

- The connected tenant contains no tested shifts for Irini, no paystubs, no messages, no pre-shift, no manager-log entries, no availability events, no tasks, and no kitchen catalog records. Empty-state behavior was therefore observed more often than populated workflows.
- No write workflow was executed, so create/edit/approval persistence is not covered by this report.
- No second browser was used to verify cross-session realtime delivery.
- No MFA challenge was exercised for Mateo or Irini; both sessions displayed standard assurance / MFA-available state.
- No external Toast, reservation, payroll, vendor, email, or AI provider was connected or tested.
- Browser console checks returned zero errors for both sessions; this does not establish backend or production data correctness.
