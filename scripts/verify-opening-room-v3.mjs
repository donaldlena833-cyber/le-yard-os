import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
// Independent database fixtures exercise the wire contract without a sibling checkout.
function migrateLedger(data) {
  const tasks = [...data.tasks];
  const budgetItems = data.budgetItems.map((item) => {
    const legacy = {
      date: "",
      recordedAt: data.updatedAt,
      actor: "Legacy import",
      note: "Original date unknown",
      legacy: true,
    };
    const workItemId =
      item.budgetRole === "operating-reserve"
        ? undefined
        : `expense-work-${item.id}`;
    if (workItemId)
      tasks.push({
        id: workItemId,
        title: item.name,
        area: item.category,
        owner: "",
        status: "todo",
        priority: "next",
        dueDate: "",
        dependsOn: [],
        notes: "",
        updatedAt: data.updatedAt,
      });
    return {
      ...item,
      workItemId,
      budgetSet: item.planned > 0,
      status: undefined,
      legacyBreakdown: item.subcategories,
      subcategories: undefined,
      commitments: item.committed
        ? [
            {
              ...legacy,
              id: `legacy-commitment-${item.id}`,
              amountCents: item.committed * 100,
            },
          ]
        : [],
      payments: item.paid
        ? [
            {
              ...legacy,
              id: `legacy-payment-${item.id}`,
              amountCents: item.paid * 100,
              kind: "payment",
            },
          ]
        : [],
      schedules: [],
    };
  });
  return { ...data, version: 3, tasks, budgetItems, activity: [] };
}
function reconciliation(a, b) {
  return {
    balanced: a.budgetItems.every((item) => {
      const next = b.budgetItems.find((e) => e.id === item.id);
      return (
        next &&
        ["planned", "committed", "paid"].every((k) => next[k] === item[k])
      );
    }),
  };
}
function syncExpense(item) {
  return {
    ...item,
    paid:
      item.payments.reduce(
        (n, p) => n + (p.kind === "refund" ? -p.amountCents : p.amountCents),
        0,
      ) / 100,
  };
}

export async function verifyOpeningRoomV3(db) {
  await db.exec(`reset role`);
  if (process.env.OPENING_ROOM_CONVERTED_PREVIEW) {
    const preview = JSON.parse(
      await readFile(process.env.OPENING_ROOM_CONVERTED_PREVIEW, "utf8"),
    );
    const checked = await db.query(
      "select private.startup_workspace_v3_violations($1::jsonb,$2::uuid) as issues",
      [JSON.stringify(preview), preview.organizationId],
    );
    assert.deepEqual(
      checked.rows[0].issues,
      [],
      "Live baseline conversion must satisfy the SQL contract",
    );
    process.stdout.write(
      "PASS read-only production baseline conversion against isolated SQL validator\n",
    );
  }
  const {
    rows: [baseline],
  } = await db.query(
    `select * from public.startup_workspaces where id='le-yard-opening'`,
  );
  const converted = migrateLedger(baseline.data);
  assert.equal(reconciliation(baseline.data, converted).balanced, true);
  let valid = await db.query(
    `select private.startup_workspace_v3_violations($1::jsonb,$2::uuid) as issues`,
    [JSON.stringify(converted), baseline.organization_id],
  );
  assert.deepEqual(
    valid.rows[0].issues,
    [],
    `V3 conversion validator: ${JSON.stringify(valid.rows)}`,
  );
  await db.exec(
    `set role authenticated; select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',false)`,
  );
  async function save(data, revision, operation = crypto.randomUUID()) {
    return (
      await db.query(
        `select * from public.save_startup_workspace_v3($1,$2,$3::jsonb,$4::uuid)`,
        ["le-yard-opening", revision, JSON.stringify(data), operation],
      )
    ).rows[0];
  }
  let snapshot = await save(converted, baseline.revision);
  assert.equal(snapshot.outcome, "saved");
  assert.equal(snapshot.data.version, 3);
  const data = structuredClone(snapshot.data);
  const work = data.tasks[0];
  let expense = {
    id: "v3-kitchen",
    workItemId: work.id,
    name: "Kitchen test",
    category: "Buildout",
    essential: false,
    planned: 90,
    budgetSet: true,
    committed: 100,
    paid: 30,
    commitments: [
      {
        id: "quote",
        amountCents: 10000,
        date: "2026-09-08",
        recordedAt: "2026-09-08T12:00:00Z",
        actor: "Spoof",
        note: "",
      },
    ],
    payments: [
      {
        id: "deposit",
        amountCents: 3000,
        date: "2026-09-09",
        recordedAt: "2026-09-09T12:00:00Z",
        actor: "Spoof",
        note: "",
        kind: "payment",
      },
    ],
    schedules: [],
  };
  data.budgetItems.push(expense);
  const op = crypto.randomUUID();
  snapshot = await save(data, snapshot.revision, op);
  assert.equal(snapshot.outcome, "saved");
  assert.notEqual(snapshot.data.budgetItems.at(-1).payments[0].actor, "Spoof");
  const replay = await save(data, snapshot.revision - 1, op);
  assert.equal(replay.revision, snapshot.revision);
  const stale = await save(snapshot.data, snapshot.revision - 1);
  assert.equal(stale.outcome, "conflict");
  async function rejects(fn, label) {
    let failed = false;
    try {
      await fn();
    } catch {
      failed = true;
    }
    assert.equal(failed, true, label);
  }
  await rejects(
    () => save({ ...data, businessName: "changed" }, snapshot.revision, op),
    "ID reuse with changed payload",
  );
  let tampered = structuredClone(snapshot.data);
  tampered.budgetItems.at(-1).payments[0].amountCents = 5000;
  tampered.budgetItems.at(-1).paid = 50;
  await rejects(
    () => save(tampered, snapshot.revision),
    "Immutable posted payment",
  );
  tampered = structuredClone(snapshot.data);
  tampered.budgetItems.at(-1).payments.push({
    ...tampered.budgetItems.at(-1).payments[0],
    id: "duplicate",
  });
  await rejects(
    () => save(tampered, snapshot.revision),
    "Unreconciled aggregate",
  );
  const refund = structuredClone(snapshot.data);
  expense = refund.budgetItems.at(-1);
  expense.payments.push({
    id: "refund",
    amountCents: 1000,
    date: "2026-09-10",
    recordedAt: "2026-09-10T12:00:00Z",
    actor: "test",
    note: "Return",
    kind: "refund",
  });
  refund.budgetItems[refund.budgetItems.length - 1] = syncExpense(expense);
  snapshot = await save(refund, snapshot.revision);
  assert.equal(snapshot.data.budgetItems.at(-1).paid, 20);
  const overpaid = structuredClone(snapshot.data);
  expense = overpaid.budgetItems.at(-1);
  expense.payments.push({
    id: "overpaid",
    amountCents: 10000,
    date: "2026-09-10",
    recordedAt: "2026-09-10T12:00:00Z",
    actor: "test",
    note: "Actual payment",
    kind: "payment",
  });
  overpaid.budgetItems[overpaid.budgetItems.length - 1] = syncExpense(expense);
  snapshot = await save(overpaid, snapshot.revision);
  assert.equal(snapshot.data.budgetItems.at(-1).paid, 120);
  await rejects(
    () =>
      db.query(`select * from public.save_startup_workspace($1,$2,$3::jsonb)`, [
        "le-yard-opening",
        snapshot.revision,
        JSON.stringify(baseline.data),
      ]),
    "Old client downgrade",
  );
  await db.exec(
    `select set_config('request.jwt.claims','{"sub":"ffffffff-ffff-4fff-8fff-ffffffffffff","role":"authenticated"}',false)`,
  );
  await rejects(
    () => save(snapshot.data, snapshot.revision),
    "Cross-tenant caller",
  );
  await db.exec("reset role");
  process.stdout.write(
    "PASS Opening Room v3 migration reconciliation, dated ledger, refunds, overpayment, immutable entries, actor attribution, idempotency, stale writes, downgrade and tenant guards\n",
  );
}
