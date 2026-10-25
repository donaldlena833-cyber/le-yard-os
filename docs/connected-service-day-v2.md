# Connected service-day v2 rehearsal

**35/35 checks passed across 13/13 required phases. Operational status: needs follow-up. Release accepted: false.**

This is the canonical current-floor command rehearsal. The fixed-clock v1 projection remains historical: its retired 17-table layout and copied expected events do not establish current operations.

## What actually ran

The final run uses synthetic business date **October 15, 2026**, with real write timestamps on October 24. Actual local Auth identifies Owner, second Owner, Host, Chef and Employee; Manager also authenticates. Application workflows and scoped RPCs perform the operational writes. Administrative fixture SQL only configures the test-only lunch/dinner services and reads results. Job qualifications, recipe configuration, stock changes, reviews and tasks use the authorized application commands.

The runner refuses remote/non-synthetic targets, existing reservations/closeouts/labor on the chosen day and an already-occupied logical floor. It retains earlier partial runs and audit history. A new run requires a fresh past service date within the synthetic payroll period and an available logical floor. The test does not reset unrelated work.

| Phase | Actual persisted checks |
| --- | --- |
| Preflight | Match DD08 revision, 20 two-tops, 40 seats and labels; configure isolated services/recipe and qualified synthetic jobs |
| Receiving | Deliver 3, accept 2, reject 1; no stock before review; receiver self-review refused; independent review and exact retries post once |
| Opening | Required-response omission refused; Employee completes two synthetic required responses; no physical safety approval implied |
| Prep | Chef saves/publishes recipe-traced prep; 1 ingredient unit consumed, 2 output units posted; exact completion replay posts once |
| Lunch brief | Owner publishes; Host/Chef/Employee acknowledge that version |
| Lunch | 18 parties / 36 covers arrive, seat, complete and release/reset |
| Handoff | Incoming second Owner explicitly accepts the original credit task; actor, note, assignment and due time persist |
| Dinner brief | Separate dinner version receives all three acknowledgements |
| Dinner | 30 completed parties / 60 covers across turns; peak 40; extra overlap refused without orphan guest; original no-show retained with separate walk-in replacement; component 86 visible to Employee |
| Availability | Stale write returns PT409 / HTTP409; valid restoration retains running-low, 86, restored history |
| Closing inventory | .25 waste independently reviewed; separate .25 unexplained cycle variance independently reviewed; exact retries post once |
| Financial | Qualified 240/120-minute manual labor; 96-cover closeout, exact retry, self-review refusal, second-Owner review; 60001-cent tip source reconciles to 40001/20000 and one audited CSV export |
| Final reconciliation | 96 completed covers /48 parties; zero active allocations; 20 logical tables available; manual closeout covers match; unresolved credit stays open and owned |

Lunch arrival waves are 11:30, 11:50, 12:10, six two-person parties each. Dinner waves are 17:00, 17:20, 17:40, 18:00, 18:30, 18:50, five two-person parties each. The synthetic policy uses 75-minute turns and 12 arriving covers per 15-minute pacing window. These are logical test inputs. Physical table combinations, reset buffers and elapsed service are unapproved.

The final run records 293 actual command spans, plus phase timestamps, in roughly 3.3 seconds of compressed commands. This is not an elapsed restaurant day or an authoritative-refresh latency guarantee. Planned meal times and actual command times are distinct fields.

## Honest scorecard

Mechanical completion requires exactly one completed record for every required phase, nonempty known evidence per phase, no duplicated checks/reused phase evidence and every check strictly true. Missing phases and unexpected outcomes fail it. Network/gateway failures cannot satisfy a refusal probe: the expected SQLSTATE is explicit.

The operational scorecard remains **needs_follow_up** because one credit is unresolved. It carries a specific synthetic accepting Owner, due time and next action; unowned issues = 0. It does not claim a vendor was contacted, a credit was paid or a replacement arrived. Release acceptance is always false, with the physical, operating-policy, POS/provider, qualified-staffing and managed-recovery gaps retained.

Manual financial inputs are $5,560 gross, $5,460 net, $60 comps, $40 voids, $1,460 expected cash, $1,455 actual cash and $4,000 card sales. There is no item-level POS import or sold-item inventory consumption. Recorded waste and count variance are distinct stock movements. Tax, revenue completeness, cash custody, restaurant tip policy and provider acceptance are outside this synthetic arithmetic test.

## Defects and retained baselines

**F40:** cycle/spot counts inherited the full-catalog requirement. The local helper now validates selected active/tracked items and base units, rejects duplicates/unknown items, derives quantities/cost server-side and still requires every active tracked item for a full count. The integrated cycle count and a separate 3/3 connected spot-count drill pass. Six new count-scope tests, seven existing inventory tests, six scorecard tests, four error-mapping cases and six schema-contract cases pass 29/29.

**F41 is now corrected locally across the reviewed family.** The original upstream timeout is retained as invalidated baseline evidence. The availability function's two raises and the remaining 70 functions/87 raises now return PT409/HTTP409 for explicit business conflicts. A current catalog audit finds none of the reviewed 40001 assignments remaining. Twelve native checks preserve the exact other body text, owners/grants/security attributes and genuine engine 40001. The actual HTTP group passes 28/28; 42 handler/error/schema cases and the complete 20-verifier portable chain also pass. See the [conflict rehearsal](business-conflict-handling.md) for scoped proof and limits.

Earlier fixture attempts lacked effective job qualifications or a past-date dinner service. A later rerun encountered existing synthetic labor. These setup failures are preserved; preflight now checks labor and uses a clean day. No historical records were deleted or their outcome rewritten to make the run pass.

## Repeat

Run from the isolated repository checkout with Node22 and the backend started. No application frontend is needed for this command rehearsal. Supply all four environment values explicitly:

```sh
LOCAL_READINESS_FIXTURE_PATH=/absolute/path/to/sandbox-fixture.private.json \
LOCAL_READINESS_STATUS_PATH=/absolute/path/to/sandbox-status.private.json \
LOCAL_READINESS_EVIDENCE_PATH=/absolute/path/to/new-evidence.json \
LOCAL_READINESS_SERVICE_DATE=YYYY-MM-DD \
npm run test:service-day:local
```

Use a fresh valid past calendar day within an open synthetic payroll period. October15,16,20,21,22,23 now contain retained integrated or partial activity; October 17–19 also contain prior financial/labor records. Inspect existing scope before choosing another day. Do not repeat into a recorded date, remove audit history or point these private files at a hosted backend.

For the focused spot drill, the same fixture/status/evidence variables suffice with `npm run test:spot-count:local`. It posts/reviews a one-item count, verifies exact retry and refuses an incomplete full count.

The local migration head is `20261024174204` (105 migrations, 317 public functions). The clean native suite passes 91/91 at this head and drops its temporary database. This is separate from actual Auth sign-in, which the connected runner supplies, and hosted acceptance, which remains open.
