# Le Yard workspace interface — locked specification

Approved on September 7, 2026. The Phone interface and its supplied light/dark reference define the shared design for Le Yard's applications. See [the original Phone specification](phone-interface.md).

## Scope

Apply this system to Operations, Host/reservations, Startup/Opening Room, booking and other Le Yard application surfaces. Preserve each surface's existing audience, routes, permissions, records and workflows. The public marketing website **leyardny.com is explicitly excluded**: do not change its design, source or deployment as part of this rollout.

This repository owns Operations, Host and Phone. Operations and Host share `src/app/workspace-design.css`, reusable UI primitives, the application shell, and reservations components. Phone's approved workspace component and CSS remain unchanged. Startup and separately hosted booking applications adopt the same specification in their own source; this document does not assert their deployment status.

## Typography

- Inter Tight throughout the interface.
- Greetings and compact headline numbers: 26px; greeting line height 32px.
- Titles: 22/28px, semibold, -0.7px tracking.
- Section headings: 18–19/24px, semibold, -0.7px tracking.
- Body/day labels: 14.5/18px, regular, +0.3px tracking; functional body copy may range from 14–16px.
- Labels and secondary metadata: 12–13px. Keep the hierarchy readable at enlarged text sizes.
- Every heading uses negative tracking, between -0.7px and -0.9px. The final negative-heading instruction supersedes the earlier positive section-heading value.
- Mobile text inputs use 16px to prevent browser zoom while preserving the intended surrounding typography.

## Color and material

Primary accent: **#3866D6**. Keep Le Yard's warm neutrals, olive brand surface and brass monogram. Use one shared component structure in light and dark modes, controlled by CSS variables:

`--text`, `--muted`, `--strong`, `--card`, `--button`, `--inner`, `--track`, `--ring`, `--primary`.

Primary text uses `--text`, secondary text `--muted`, icons `--strong`. Primary actions use blue with readable foreground text. Status colors retain their meaning: occupied/seated, reset/late, blocked, errors and success must remain distinguishable beyond color alone. Never invent occupancy, metrics, unread counts or readiness.

Cards have no visible borders. Use an inset highlight, a subtle 1px ring and layered soft drop shadows. Circular controls use a 6px inset highlight and soft drop shadows. Dividers are 1px `var(--track)`.

## Geometry and spacing

- Circular icon controls: 38–46px, 50% radius. Shared text actions preserve a 44px minimum target.
- Outer cards: 22px radius; ordinary cards: 18px; rows/chips: 11–14px.
- Page margins: 26px, reducing to 20px only on very narrow screens.
- Group spacing: 16–22px; component spacing: 8–12px.
- Mobile navigation floats in a capsule above the safe area. Sticky workflow actions remain above it, with clearance.
- Desktop navigation uses a compact floating surface. Menus, search, notifications and settings use the same material hierarchy.
- Floor-map table geometry remains meaningful operational data; table sizes and positions are not constrained by circular icon-button dimensions.

## Interaction and verification

Use short entrances, tactile press feedback and smooth active/theme transitions. Respect reduced motion. Store appearance choice locally, tolerating unavailable storage. Keep visible keyboard focus, semantic labels, focus containment and return-focus behavior.

Preserve all authentication, authorization, mutation, idempotency, consent and provider contracts. Review desktop/mobile, light/dark, navigation, forms, dialogs, empty/error states and real operational workflows. A passing build or rendered UI does not establish provider acceptance or production readiness.
