import test from 'node:test';
import assert from 'node:assert/strict';
import { readConfig, numberPlan, messagePlan, probe, configure, LE_YARD_NUMBER, LE_YARD_ORIGIN } from './twilio-configure.mjs';
const accountSid = 'AC' + 'a'.repeat(32);
const env = { TWILIO_ACCOUNT_SID: accountSid, TWILIO_AUTH_TOKEN: 'test-token' };
const config = readConfig(env);
const phone = { sid: 'PN' + 'b'.repeat(32), phoneNumber: LE_YARD_NUMBER,
  accountSid, capabilities: { voice: true, sms: true, mms: true } };
const service = { sid: 'MG' + 'c'.repeat(32), accountSid, friendlyName: 'Le Yard Guest Care' };

test('fails closed without credentials', () => assert.throws(() => readConfig({}), /TWILIO_ACCOUNT_SID/));
test('never routes a different number', () => assert.throws(() => readConfig({ ...env, TWILIO_PHONE_NUMBER: '+12125550123' }), /only the existing/));
test('rejects previews and attacker hosts', () => {
  for (const url of ['http://operations.leyardny.com', 'https://example.com', 'https://operations.leyardny.com.evil.test'])
    assert.throws(() => readConfig({ ...env, TWILIO_PUBLIC_BASE_URL: url }), /unapproved host/);
});
test('rejects partial API key configuration', () => assert.throws(() => readConfig({ ...env, TWILIO_API_KEY_SID: 'SKtest' }), /Both API/));
test('rejects another accounts number', () => assert.throws(() => numberPlan({ ...phone, accountSid: 'ACother' }, config), /not owned/));
test('requires both Voice and SMS', () => assert.throws(() => numberPlan({ ...phone, capabilities: { voice: true } }, config), /Voice and SMS/));
test('plans only canonical POST callbacks', () => {
  assert.equal(numberPlan(phone, config).voiceUrl, `${LE_YARD_ORIGIN}/api/twilio/voice/incoming`);
  assert.equal(numberPlan(phone, config).voiceMethod, 'POST');
  assert.equal(messagePlan(service, config).useInboundWebhookOnNumber, false);
});
test('refuses messaging service account mismatch', () => assert.throws(() => messagePlan({ ...service, accountSid: 'bad' }, config), /mismatch/));
test('unsigned accepting server blocks provisioning', async () => {
  await assert.rejects(probe(config, 'voice', async () => new Response('{}', { status: 200 })), /Unsigned/);
});
test('sign-in redirect blocks provisioning', async () => {
  let count = 0;
  await assert.rejects(probe(config, 'voice', async () => new Response(null, { status: count++ ? 307 : 403 })), /Signed readiness/);
});
test('signature probe never sends the auth token', async () => {
  let count = 0;
  await probe(config, 'voice', async (_url, init) => {
    assert.equal(JSON.stringify(init).includes('test-token'), false);
    if (count++ === 0) return new Response(null, { status: 403 });
    assert.ok(init.headers['x-twilio-signature']);
    return Response.json({ protocol: 'le-yard-twilio-v1', ready: true, channel: 'voice' });
  });
});
test('dry run makes no configuration mutations or probes', async () => {
  const client = { incomingPhoneNumbers: { list: async () => [phone] } };
  const result = await configure(client, config, {}, async () => { throw new Error('unexpected probe'); });
  assert.equal(result.applied, false);
  assert.equal(result.liveCarrierTestsPassed, false);
});
test('missing owned number is never replaced by a purchase', async () => {
  await assert.rejects(configure({ incomingPhoneNumbers: { list: async () => [] } }, config), /No number will be purchased/);
});
test('failed readiness makes zero provider writes', async () => {
  let writes = 0;
  const resource = () => ({ update: async () => { writes++; } });
  resource.list = async () => [phone];
  await assert.rejects(configure({ incomingPhoneNumbers: resource }, config, { apply: true }, async () => { throw new Error('not ready'); }), /not ready/);
  assert.equal(writes, 0);
});
