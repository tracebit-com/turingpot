import { importSecret, seal, unseal } from './cursor.js';
import { manifestPage } from './manifest.js';
import { config } from './config.js';

const maxBodyBytes = 32 * 1024;

function json(body, status, headers = {}) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

async function readSubmission(request) {
  const type = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') return json({ error: 'Use application/json.' }, 415);
  const reader = request.body?.getReader();
  if (!reader) return json({ error: 'Missing submission.' }, 400);
  const chunks = [];
  let size = 0;
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBodyBytes) {
        await reader.cancel();
        return json({ error: 'Submission too large.' }, 413);
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    const body = JSON.parse(chunks.join(''));
    if (body && typeof body === 'object' && !Array.isArray(body)) return body;
  } catch {
    // Malformed or interrupted submissions never advance the manifest.
  } finally {
    reader.releaseLock();
  }
  return json({ error: 'Invalid submission.' }, 400);
}

function remember(values, value, limit) {
  if (typeof value !== 'string') return;
  const cleaned = value.slice(0, limit).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (cleaned && !values.includes(cleaned)) values.push(cleaned);
}

export async function inventory(request, {
  secret, sourceIp, ja4, log = console.log, now = Date.now, settings = config, pathname,
}) {
  const url = new URL(request.url);
  if ((pathname ?? url.pathname) !== settings.apiPath) return json({ error: 'Unknown collection.' }, 404);
  if (!['GET', 'POST'].includes(request.method)) {
    return json({ error: 'Unsupported method.' }, 405, { Allow: 'GET, POST' });
  }
  const key = await importSecret(secret);
  if (!key) return json({ error: 'Collection unavailable.' }, 503);

  let state;
  const timestamp = now();
  if (request.method === 'GET') {
    state = {
      id: crypto.randomUUID(), started: timestamp, accepted: 0,
      earlyAfter: settings.earlySignalAfter, completeAfter: settings.completeAfter,
      ips: [], agents: [], fingerprints: [],
    };
  } else {
    const body = await readSubmission(request);
    if (body instanceof Response) return body;
    state = await unseal(body.cursor, key, url.host, timestamp);
    if (!state) return json({ error: 'Invalid or expired cursor. Reopen the collection.' }, 400);
    if (body.record !== state.answer.record || body.value !== state.answer.value) {
      return json({ error: 'Manifest mismatch. Reconcile the previous page and retry with the same cursor.' }, 409);
    }
    state.accepted++;
  }

  remember(state.ips, sourceIp, 64);
  remember(state.agents, request.headers.get('user-agent'), 256);
  remember(state.fingerprints, ja4, 96);
  // Older cursors used fixed milestones and carry no threshold fields.
  const early = state.accepted === (state.earlyAfter ?? 3);
  const complete = state.accepted === (state.completeAfter ?? 12);
  if (early || complete) {
    const event = early ? 'possible_ai_agent' : 'pagination_sequence_completed';
    log({
      event, session_id: state.id, hostname: url.hostname,
      checkpoints: state.accepted, first_seen: new Date(state.started).toISOString(),
      last_seen: new Date(timestamp).toISOString(), elapsed_ms: Math.max(0, timestamp - state.started),
      source_ips: state.ips, user_agents: state.agents, ja4: state.fingerprints,
    });
  }
  if (complete) {
    return json({ complete: true, items: [] }, 200);
  }

  const page = manifestPage(settings.puzzles, settings.instructions);
  state.answer = page.answer;
  return json({
    page: state.accepted + 1,
    detail: page.detail,
    records: page.records,
    continuation: {
      method: 'POST', path: settings.apiPath, cursor: await seal(state, key, url.host),
      format: 'Send a JSON object with cursor (unchanged), record (string) and value (integer).',
    },
  }, state.accepted === 0 ? 409 : 200);
}
