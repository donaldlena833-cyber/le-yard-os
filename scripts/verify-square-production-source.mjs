import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const ownerId = "10000000-0000-4000-8000-000000000001";
const employeeId = "10000000-0000-4000-8000-000000000005";
const organizationId = "20000000-0000-4000-8000-000000000001";
const locationId = "30000000-0000-4000-8000-000000000001";
const otherLocationId = "30000000-0000-4000-8000-000000000002";

export async function verifySquareProductionSource(db) {
  const response = async (sql, params) => (await db.query(sql, params)).rows[0];
  const result = async (sql, params) => (await response(sql, params)).result;
  const signIn = async (role, sub) => {
    await db.exec(`reset role; set role ${role}`);
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role, sub, aal: "aal1" })]);
  };
  const expectDenied = async (operation, code) => {
    await db.exec("savepoint square_denial");
    try {
      await assert.rejects(operation, { code });
    } finally {
      await db.exec("rollback to square_denial; release square_denial");
    }
  };
  const configure = (environment, location, merchant, squareLocation, enabled, requestId = randomUUID()) => result(
    environment === "production"
      ? "select public.configure_square_production_source_connection($1,$2,$3,$4,$5) as result"
      : "select public.configure_square_source_connection($1,$2,$3,$4,$5) as result",
    [requestId, location, merchant, squareLocation, enabled],
  );
  const windowFrom = "2026-09-01T00:00:00Z";
  const windowTo = "2026-09-02T00:00:00Z";
  const ingest = (connectionId, scope, snapshots, requestId = randomUUID()) => result(
    "select public.service_ingest_square_production_source_window($1,$2,$3,$4,$5,$6) as result",
    [requestId, connectionId, windowFrom, windowTo, JSON.stringify(snapshots), JSON.stringify(scope)],
  );
  const scope = (merchantId, locationId) => ({
    environment: "production",
    merchantId,
    locationId,
    currency: "USD",
    timeZone: "America/New_York",
    mode: "source_evidence_only",
    contract: "square-source-evidence-v1",
  });

  await db.exec("reset role; begin");
  try {
    await db.exec("select set_config('request.jwt.claims', '{}', true)");
    await db.query("update public.organizations set slug='le-yard' where id=$1", [organizationId]);
    await db.query("update public.locations set code='MAIN' where id=$1", [locationId]);
    await signIn("authenticated", employeeId);
    await expectDenied(() => configure("production", locationId, "M_FIXTURE", "L_FIXTURE", true), "42501");

    await signIn("authenticated", ownerId);
    await expectDenied(() => configure("production", otherLocationId, "M_FIXTURE", "L_FIXTURE", true), "42501");
    const sandbox = await configure("sandbox", locationId, "M_SANDBOX", "L_SANDBOX", true);
    assert.equal(sandbox.environment, "sandbox");
    await signIn("service_role");
    await expectDenied(() => ingest(sandbox.id, scope("M_FIXTURE", "L_FIXTURE"), []), "42501");

    await signIn("authenticated", ownerId);
    const requestId = randomUUID();
    const production = await configure("production", locationId, "M_FIXTURE", "L_FIXTURE", true, requestId);
    assert.deepEqual(production, {
      id: sandbox.id, status: "pending", environment: "production", financialPostingEnabled: false,
    });
    assert.deepEqual(await configure("production", locationId, "M_FIXTURE", "L_FIXTURE", true, requestId), production);
    await configure("production", locationId, "M_FIXTURE", "L_FINAL", true);
    await expectDenied(() => configure("production", locationId, "M_FIXTURE", "L_FIXTURE", true, requestId), "PT409");

    await signIn("service_role");
    await expectDenied(() => result(
      "select public.service_ingest_square_source_window($1,$2,$3,$4,'[]') as result",
      [randomUUID(), production.id, windowFrom, windowTo],
    ), "42501");
    await expectDenied(() => ingest(production.id, scope("M_FIXTURE", "L_FIXTURE"), []), "PT409");
    await expectDenied(() => ingest(production.id, null, []), "PT409");
    const exactScope = scope("M_FIXTURE", "L_FINAL");
    await expectDenied(() => result(
      "select public.service_ingest_square_production_source_window($1,$2,$3,$4,'[]',$5) as result",
      [randomUUID(), production.id, windowFrom, "2026-09-04T00:00:01Z", JSON.stringify(exactScope)],
    ), "22023");
    const firstId = randomUUID();
    assert.equal((await ingest(production.id, exactScope, [], firstId)).recordsProcessed, 0);
    assert.equal((await ingest(production.id, exactScope, [], firstId)).replayed, true);

    await signIn("authenticated", ownerId);
    await expectDenied(() => configure("sandbox", locationId, "M_SANDBOX", "L_SANDBOX", true), "PT409");
    await expectDenied(() => configure("production", locationId, "M_FIXTURE", "L_DIFFERENT", true), "PT409");
    const paused = await configure("production", locationId, "M_FIXTURE", "L_FINAL", false);
    assert.equal(paused.status, "disabled");
    await signIn("service_role");
    await expectDenied(() => ingest(production.id, exactScope, []), "42501");

    await signIn("authenticated", ownerId);
    assert.equal((await configure("production", locationId, "M_FIXTURE", "L_FINAL", true)).status, "pending");
    await signIn("service_role");
    const updated = "2026-09-01T21:00:00Z";
    const imported = await ingest(production.id, exactScope, [{
      kind: "order",
      externalId: "ORDER_FIXTURE",
      sourceUpdatedAt: updated,
      objectVersion: 1,
      facts: {
        id: "ORDER_FIXTURE",
        location_id: exactScope.locationId,
        created_at: "2026-09-01T18:00:00Z",
        updated_at: updated,
        state: "COMPLETED",
        version: 1,
        total_money: { currency: "USD", amount: 1000 },
      },
    }]);
    assert.equal(imported.versionsInserted, 1);
    assert.equal(imported.financialPostingEnabled, false);
    assert.equal(imported.reconciliation, "pending");
    await db.exec("reset role");
    assert.deepEqual(await result("select source_scope as result from private.square_source_runs where id=$1", [imported.id]), exactScope);
  } finally {
    await db.exec("rollback");
  }
}
