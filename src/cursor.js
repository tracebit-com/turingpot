const utf8 = new TextEncoder();
const lifetimeMs = 60 * 60 * 1000;

function encode(bytes) {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function decode(text) {
  return Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), ch => ch.charCodeAt(0));
}

export function importSecret(secret) {
  if (typeof secret !== 'string' || !/^[0-9a-f]{64}$/i.test(secret)) return null;
  const bytes = Uint8Array.from(secret.match(/../g), pair => parseInt(pair, 16));
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function algorithm(iv, host) {
  return { name: 'AES-GCM', iv, additionalData: utf8.encode('inventory-v1/' + host) };
}

export async function seal(state, key, host) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = utf8.encode(JSON.stringify(state));
  const encrypted = await crypto.subtle.encrypt(algorithm(iv, host), key, data);
  return encode(iv) + '.' + encode(new Uint8Array(encrypted));
}

export async function unseal(cursor, key, host, now) {
  if (typeof cursor !== 'string' || !/^[\w-]{16}\.[\w-]{23,30000}$/.test(cursor)) return null;
  try {
    const [nonce, payload] = cursor.split('.');
    const data = await crypto.subtle.decrypt(algorithm(decode(nonce), host), key, decode(payload));
    const state = JSON.parse(new TextDecoder().decode(data));
    if (now - state.started > lifetimeMs) return null;
    return state;
  } catch {
    return null;
  }
}
