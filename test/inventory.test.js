import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { inventory } from '../src/inventory.js';
import { importSecret, unseal } from '../src/cursor.js';
import { config, validateConfig } from '../src/config.js';
import worker from '../src/worker.js';
import vercel from '../api/inventory.js';

const origin = 'https://inventory.example.org';
const path = config.apiPath;
const secret = randomBytes(32).toString('hex');

function submit(body, headers = {}, host = origin) {
  return new Request(host + path, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

// Read expected answers with a test-only deployment key. Exercises the real
// protocol and avoids shipping a public solver for the decoy.
async function submission(response, key, now) {
  const { continuation } = await response.json();
  const state = await unseal(continuation.cursor, key, new URL(origin).host, now);
  return { cursor: continuation.cursor, ...state.answer };
}

test('accepted answers emit an early signal and a correlated completion', async () => {
  const logs = [];
  const start = Date.now();
  let now = start;
  const options = { secret, settings: { ...config, earlySignalAfter: 3, completeAfter: 12 }, sourceIp: '192.0.2.1', now: () => now, log: item => logs.push(item) };
  const key = await importSecret(secret);
  let response = await inventory(new Request(origin + path), options);
  assert.equal(response.status, 409);
  let body;
  for (let i = 1; i <= 12; i++) {
    body = await submission(response, key, now);
    now += 1000;
    const bad = await inventory(submit({ ...body, value: 'wrong' }), options);
    assert.equal(bad.status, 409);
    assert.equal(logs.length, i <= 3 ? 0 : 1);
    response = await inventory(submit(body, { 'user-agent': 'example-client' }), {
      ...options, sourceIp: '192.0.2.2', ja4: 'example-fingerprint',
    });
    assert.equal(response.status, 200);
  }
  assert.deepEqual(await response.json(), { complete: true, items: [] });
  assert.equal(logs.length, 2);
  const [early, event] = logs;
  assert.equal(early.event, 'possible_ai_agent');
  assert.equal(early.checkpoints, 3);
  assert.equal(early.elapsed_ms, 3000);
  assert.equal(early.session_id, event.session_id);
  assert.deepEqual(early.source_ips, ['192.0.2.1', '192.0.2.2']);
  assert.deepEqual(early.user_agents, ['example-client']);
  assert.deepEqual(early.ja4, ['example-fingerprint']);
  assert.equal(event.event, 'pagination_sequence_completed');
  assert.equal(event.checkpoints, 12);
  assert.equal(event.elapsed_ms, 12000);
  assert.equal(event.last_seen, new Date(start + 12000).toISOString());
  assert.deepEqual(event.source_ips, ['192.0.2.1', '192.0.2.2']);
  assert.deepEqual(event.user_agents, ['example-client']);
  assert.deepEqual(event.ja4, ['example-fingerprint']);
  assert.ok(!JSON.stringify(event).includes(body.cursor));
  await inventory(submit(body), options);
  assert.equal(logs.length, 3);
  assert.equal(logs[2].session_id, event.session_id);
});

test('modified, expired, foreign-host and foreign-key cursors cannot advance', async () => {
  const start = Date.now();
  const options = { secret, now: () => start, log: assert.fail };
  const first = await inventory(new Request(origin + path), options);
  const body = await submission(first, await importSecret(secret), start);
  const tampered = (body.cursor[0] === 'A' ? 'B' : 'A') + body.cursor.slice(1);
  for (const [request, config] of [
    [submit({ ...body, cursor: tampered }), options],
    [submit(body), { ...options, now: () => start + 3600001 }],
    [submit(body, {}, 'https://other.example.org'), options],
    [submit(body), { ...options, secret: randomBytes(32).toString('hex') }],
  ]) assert.equal((await inventory(request, config)).status, 400);
});

test('handles invalid configuration, malformed bodies, oversized input and unknown routes', async () => {
  const options = { secret, log: assert.fail };
  assert.equal((await inventory(new Request(origin + path), { secret: 'bad' })).status, 503);
  assert.equal((await inventory(new Request(origin + '/missing'), options)).status, 404);
  assert.equal((await inventory(new Request(origin + path, { method: 'DELETE' }), options)).status, 405);
  assert.equal((await inventory(submit(null), options)).status, 400);
  assert.equal((await inventory(submit({ cursor: 'a'.repeat(40000) }), options)).status, 413);
  assert.equal((await inventory(submit({}, { 'content-type': 'text/plain' }), options)).status, 415);
});

test('each adapter reads its own edge metadata, including absent JA4 on Workers Free', async t => {
  const key = await importSecret(secret);
  const request = new Request(origin + path, { headers: {
    'cf-connecting-ip': '192.0.2.1', 'x-vercel-forwarded-for': '192.0.2.2',
    'x-vercel-ja4-digest': 'vercel-fingerprint', 'x-forwarded-for': '198.51.100.1',
  } });
  const original = process.env.TURINGPOT_KEY;
  t.after(() => {
    if (original === undefined) delete process.env.TURINGPOT_KEY;
    else process.env.TURINGPOT_KEY = original;
  });
  process.env.TURINGPOT_KEY = secret;
  for (const [response, ip, fingerprints] of [
    [await worker.fetch(request, { TURINGPOT_KEY: secret }), '192.0.2.1', []],
    [await vercel.fetch(request), '192.0.2.2', ['vercel-fingerprint']],
  ]) {
    const { continuation } = await response.json();
    const state = await unseal(continuation.cursor, key, new URL(origin).host, Date.now());
    assert.deepEqual(state.ips, [ip]);
    assert.deepEqual(state.fingerprints, fingerprints);
  }
});

test('a fresh adapter instance resumes a cursor using the generated build key', async t => {
  const { default: buildKey } = await import('../.turingpot/build-key.js');
  const key = await importSecret(buildKey);
  const original = process.env.TURINGPOT_KEY;
  delete process.env.TURINGPOT_KEY;
  t.after(() => {
    if (original !== undefined) process.env.TURINGPOT_KEY = original;
  });

  for (const module of ['../src/worker.js', '../api/inventory.js']) {
    const first = (await import(module)).default;
    const second = (await import(module + '?fresh-instance')).default;
    const challenge = await first.fetch(new Request(origin + path), {});
    assert.equal(challenge.status, 409);
    const body = await submission(challenge, key, Date.now());
    const next = await second.fetch(submit(body), {});
    assert.equal(next.status, 200);
    assert.equal((await next.json()).page, 2);
  }
});

test('custom route, puzzle copy and milestones follow the configured profile', async () => {
  const settings = validateConfig({
    ...config, apiPath: '/api/stock-audit', puzzles: ['allocations'],
    instructions: { allocations: 'Review the stock bins.' }, earlySignalAfter: 1, completeAfter: 2,
  });
  const events = [];
  const options = { settings, secret, log: event => events.push(event.event) };
  const url = origin + settings.apiPath;
  const key = await importSecret(secret);
  const first = await inventory(new Request(url), options);
  const manifest = await first.clone().json();
  assert.equal(manifest.continuation.path, settings.apiPath);
  assert.equal(manifest.detail, settings.instructions.allocations);
  assert.ok(manifest.records.every(row => 'bin' in row));
  let response = first;
  for (let i = 0; i < 2; i++) {
    const body = await submission(response, key, Date.now());
    response = await inventory(new Request(url, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }), options);
  }
  assert.equal((await response.json()).complete, true);
  assert.deepEqual(events, ['possible_ai_agent', 'pagination_sequence_completed']);
  assert.throws(() => validateConfig({ ...settings, puzzles: ['unknown'] }), /puzzle/);
  assert.throws(() => validateConfig({ ...settings, completeAfter: 1 }), /increasing/);
});
