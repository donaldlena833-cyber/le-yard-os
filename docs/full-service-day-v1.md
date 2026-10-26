# Full-service-day-v1 pressure test

`full-service-day-v1` is a historical, fixed-clock projection fixture. It uses the retired 17-table floor and is not the current readiness acceptance scenario. The [connected service-day v2 rehearsal](connected-service-day-v2.md) replaces it for current-floor command validation. This historical manifest still drives the demonstration projections in Today, Host, Service Control, kitchen/Prep, Inventory, Income, Closeout, and Reports; those screens are not evidence that its projected events were executed.

## October 24 readiness finding

This historical fixture uses the retired 17-table / 68-seat floor, rather than
the current DD08 20-table / 40-seat definition. Its event results and timings are
scripted projections, not measured connected commands. It must not be used to
accept current room capacity or real response times.

The scorecard now checks observed result codes and unresolved exceptions. The
existing fixture finishes with two unresolved exceptions, so a replay correctly
fails locally. Do not clear that count to make a test green: reconcile the
exceptions with named resolution or accepted handoff evidence in the replacement
current-floor scenario.

## Locked outcomes

| Period | Covers | Peak | Gross | Comps | Voids | Net | Average |
|---|---:|---:|---:|---:|---:|---:|---:|
| Lunch | 36 | 36 | $1,260 | $0 | $0 | $1,260 | $35 |
| Dinner | 60 | 60 | $4,300 | $60 | $40 | $4,200 | $70 |
| Day | 96 | 60 | $5,560 | $60 | $40 | $5,460 | $56.88 |

Dinner uses all 17 draft tables in five 12-cover waves. The sold mix is 60 mains, 30 starters, 24 desserts, and 72 beverages. The synthetic POS fixture creates 29 item-level checks, while recipe lines create Prep usage, inventory-consumption, structured-waste, and blind-count expectations.

## Local controls

The controls write only to `output/service-simulation/`, which is ignored by Git. Each command refuses `VERCEL_ENV=production` and supplies the isolated simulation scope itself.

```bash
npm run simulation:seed -- clean-run-01
npm run simulation:inject -- clean-run-01 receiving-exception
npm run simulation:advance -- clean-run-01 20:00
npm run simulation:pause -- clean-run-01
npm run simulation:reset -- clean-run-01
npm run simulation:run -- clean-run-01
npm run simulation:report -- clean-run-01
npm run simulation:replay -- 10
```

Event injection is ordered. Reset requires the exact synthetic run ID and removes no tenant, production, or cross-run data.
The exported report is written to `output/service-simulation/<run-id>.report.json`.
Numbered phase screenshots referenced by each ledger event resolve from
`output/service-simulation/evidence/`.

To render the fixture in local demo mode:

```bash
NEXT_PUBLIC_DEMO_MODE=true NEXT_PUBLIC_SERVICE_SIMULATION=full-service-day-v1 npm run dev
```

Simulation controls are intentionally absent from normal navigation.

## Gates and truth boundary

The deterministic local replay may pass while release remains blocked. The exported report keeps these gates separate:

- isolated connected Supabase rehearsal;
- staffed physical-room and device rehearsal;
- managed backup/PITR and private Storage recovery.

Do not convert a local replay, screenshot, preview HTTP response, or passing build into evidence that a connected or physical gate passed. Public booking, provider delivery, Toast, payments, payroll, purchasing, and Opening Room mutation remain disabled or out of scope until separately authorized and evidenced.
