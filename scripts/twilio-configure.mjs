#!/usr/bin/env node
/** Configure the EXISTING Le Yard number. Read-only unless --apply is supplied.
 * Credentials come only from environment variables. Never buys numbers, creates
 * campaigns, sends messages, or places calls. Keep carrier testing separate.
 */
import { createHmac, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const LE_YARD_NUMBER = '+13328779035';
export const LE_YARD_ORIGIN = 'https://operations.leyardny.com';

export function readConfig(env = process.env) {
  const required = name => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`Secure configuration missing: ${name}`);
    return value;
  };
  const accountSid = required('TWILIO_ACCOUNT_SID');
  if (!/^AC[0-9a-f]{32}$/i.test(accountSid)) throw new Error('Invalid account SID.');
  const authToken = required('TWILIO_AUTH_TOKEN');
  const keySid = env.TWILIO_API_KEY_SID?.trim();
  const keySecret = env.TWILIO_API_KEY_SECRET?.trim();
  if (Boolean(keySid) !== Boolean(keySecret)) throw new Error('Both API key fields are required.');
  const origin = (env.TWILIO_PUBLIC_BASE_URL || LE_YARD_ORIGIN).replace(/\/$/, '');
  if (origin !== LE_YARD_ORIGIN) throw new Error('Refusing to route the public number to a preview or unapproved host.');
  const number = env.TWILIO_FROM_NUMBER || env.TWILIO_PHONE_NUMBER || LE_YARD_NUMBER;
  if (number !== LE_YARD_NUMBER) throw new Error('This script configures only the existing Le Yard business number.');
  const serviceSid = env.TWILIO_MESSAGING_SERVICE_SID?.trim();
  if (serviceSid && !/^MG[0-9a-f]{32}$/i.test(serviceSid)) throw new Error('Invalid Messaging Service SID.');
  return { accountSid, authToken, keySid, keySecret, origin, number, serviceSid };
}

export function numberPlan(phone, config) {
  if (phone.accountSid !== config.accountSid || phone.phoneNumber !== LE_YARD_NUMBER)
    throw new Error('The number is not owned by the configured Le Yard account.');
  if (!phone.capabilities?.voice || !phone.capabilities?.sms)
    throw new Error('The selected number must support Voice and SMS.');
  if (!/^PN[0-9a-f]{32}$/i.test(phone.sid)) throw new Error('Invalid number resource.');
  return {
    voiceUrl: `${config.origin}/api/twilio/voice/incoming`, voiceMethod: 'POST',
    statusCallback: `${config.origin}/api/twilio/voice/status`, statusCallbackMethod: 'POST',
  };
}

export function messagePlan(service, config) {
  if (service.accountSid !== config.accountSid || !/^MG[0-9a-f]{32}$/i.test(service.sid))
    throw new Error('Messaging Service account mismatch.');
  return {
    inboundRequestUrl: `${config.origin}/api/twilio/sms/incoming`, inboundMethod: 'POST',
    statusCallback: `${config.origin}/api/twilio/sms/status`,
    useInboundWebhookOnNumber: false, smartEncoding: true,
  };
}

export async function probe(config, channel, fetcher = fetch) {
  const url = `${config.origin}/api/twilio/readiness`;
  const values = { AccountSid: config.accountSid, To: config.number,
    ProbeChannel: channel, Timestamp: String(Math.floor(Date.now() / 1000)), Nonce: randomUUID() };
  const body = new URLSearchParams(values).toString();
  const payload = url + Object.keys(values).sort().map(key => key + values[key]).join('');
  const signature = createHmac('sha1', config.authToken).update(payload).digest('base64');
  const base = { method: 'POST', redirect: 'manual', body,
    headers: { 'content-type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(10000) };
  const rejected = await fetcher(url, base);
  if (rejected.status !== 403) throw new Error('Unsigned webhook probe was not rejected with 403. Routing unchanged.');
  const accepted = await fetcher(url, { ...base, signal: AbortSignal.timeout(10000),
    headers: { ...base.headers, 'x-twilio-signature': signature } });
  if (accepted.status !== 200) throw new Error(`Signed readiness probe failed (${accepted.status}). Routing unchanged.`);
  const result = await accepted.json();
  if (result.protocol !== 'le-yard-twilio-v1' || result.ready !== true || result.channel !== channel)
    throw new Error('Deployment readiness was not established. Routing unchanged.');
}

export async function configure(client, config, { apply = false, channel = 'voice' } = {}, probeFn = probe) {
  if (!['voice', 'messaging', 'both'].includes(channel)) throw new Error('Choose voice, messaging, or both.');
  const phones = await client.incomingPhoneNumbers.list({ phoneNumber: config.number, limit: 2 });
  if (phones.length !== 1) throw new Error('Exactly one owned Le Yard number must be found. No number will be purchased.');
  const phone = phones[0];
  const voice = numberPlan(phone, config);
  let service, messaging, campaigns = [];
  if (channel !== 'voice') {
    const candidates = config.serviceSid
      ? [await client.messaging.v1.services(config.serviceSid).fetch()]
      : (await client.messaging.v1.services.list({ limit: 100 }))
          .filter(item => item.friendlyName === 'Le Yard Guest Care');
    if (candidates.length !== 1) throw new Error('Set TWILIO_MESSAGING_SERVICE_SID for the existing Le Yard Guest Care service. No duplicate will be created.');
    service = candidates[0];
    messaging = messagePlan(service, config);
    const senders = await client.messaging.v1.services(service.sid).phoneNumbers.list({ limit: 100 });
    if (!senders.some(sender => sender.sid === phone.sid))
      throw new Error('The Le Yard number is not in this service sender pool. No other service will be modified.');
    campaigns = await client.messaging.v1.services(service.sid).usAppToPerson.list({ limit: 10 });
  }
  const summary = { number: phone.phoneNumber, numberSid: phone.sid, channel,
    serviceSid: service?.sid ?? null,
    campaignStatuses: campaigns.map(c => ({ status: c.campaignStatus, mock: c.mock === true })),
    mmsCapable: phone.capabilities.mms === true,
    proposed: { ...(channel !== 'messaging' ? { voice } : {}), ...(messaging ? { messaging } : {}) },
    applied: false, liveCarrierTestsPassed: false };
  if (!apply) return summary;
  if (channel !== 'messaging') await probeFn(config, 'voice');
  if (channel !== 'voice') await probeFn(config, 'messaging');
  // Record the exact prior settings before any mutation, outside the repository.
  const directory = resolve(homedir(), '.le-yard', 'twilio-backups');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const backup = resolve(directory, `${Date.now()}-${randomUUID()}.json`);
  const pick = (item, keys) => Object.fromEntries(keys.map(key => [key, item[key] ?? null]));
  await writeFile(backup, JSON.stringify({ numberSid: phone.sid, serviceSid: service?.sid,
    voice: pick(phone, Object.keys(voice)),
    messaging: service ? pick(service, Object.keys(messaging)) : null }, null, 2), { mode: 0o600, flag: 'wx' });
  if (channel !== 'messaging') await client.incomingPhoneNumbers(phone.sid).update(voice);
  if (channel !== 'voice') await client.messaging.v1.services(service.sid).update(messaging);
  // Read back instead of treating an accepted update request as verification.
  if (channel !== 'messaging') {
    const current = await client.incomingPhoneNumbers(phone.sid).fetch();
    if (Object.entries(voice).some(([key, value]) => current[key] !== value))
      throw new Error('Voice configuration read-back mismatch. Inspect the private backup before retrying.');
  }
  if (channel !== 'voice') {
    const current = await client.messaging.v1.services(service.sid).fetch();
    if (Object.entries(messaging).some(([key, value]) => current[key] !== value))
      throw new Error('Messaging configuration read-back mismatch. Inspect the private backup before retrying.');
  }
  return { ...summary, applied: true, backup };
}

async function main() {
  if (process.argv.includes('--help')) {
    console.log('node scripts/twilio-configure.mjs [--channel=voice|messaging|both] [--apply]\nDefault is a read-only plan. Requires secure Twilio environment variables.');
    return;
  }
  const config = readConfig();
  const { default: twilio } = await import('twilio');
  const client = twilio(config.keySid || config.accountSid, config.keySecret || config.authToken,
    { accountSid: config.accountSid, autoRetry: false, timeout: 10000 });
  const channel = process.argv.find(arg => arg.startsWith('--channel='))?.split('=')[1] || 'voice';
  console.log(JSON.stringify(await configure(client, config, { channel, apply: process.argv.includes('--apply') }), null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    // Twilio error bodies may contain destinations; never print credentials or raw responses.
    console.error(error?.code ? `Twilio operation failed, code ${error.code}. Review the account securely.` : error.message);
    process.exitCode = 1;
  });
}
