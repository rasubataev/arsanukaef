/**
 * REELSMAKER admin backend.
 *
 * Endpoints:
 *   GET  /content   -> public, returns the current site content JSON
 *   POST /login      -> { password } -> { token, expiresIn } on success, 401 otherwise
 *   PUT  /content   -> requires "Authorization: Bearer <token>", stores the new content JSON
 *
 * Storage: a Cloudflare KV namespace bound as CONTENT_KV, single key "content".
 * Secrets (set with `wrangler secret put <name>`):
 *   ADMIN_PASSWORD   - the password checked at /login
 *   SESSION_SECRET   - random string used to sign session tokens
 */

const TOKEN_TTL_SECONDS = 12 * 60 * 60; // 12h admin session
const KV_KEY = 'reelsmaker_content'; // namespaced so it can't collide with other projects sharing this KV namespace

function corsHeaders(origin) {
  const allowed = new Set([
    'https://arsanukaef.ru',
    'https://www.arsanukaef.ru',
  ]);
  const allowOrigin = allowed.has(origin) ? origin : 'https://arsanukaef.ru';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

function json(data, init, origin) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(origin),
      ...(init && init.headers ? init.headers : {}),
    },
  });
}

function bufToBase64Url(buf) {
  let str = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBuf(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(b64url.length + ((4 - (b64url.length % 4)) % 4), '=');
  const str = atob(b64);
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
  return bytes.buffer;
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

async function signToken(payload, secret) {
  const key = await hmacKey(secret);
  const payloadStr = JSON.stringify(payload);
  const payloadB64 = bufToBase64Url(new TextEncoder().encode(payloadStr));
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64));
  const sigB64 = bufToBase64Url(sig);
  return `${payloadB64}.${sigB64}`;
}

async function verifyToken(token, secret) {
  if (!token || token.indexOf('.') === -1) return null;
  const [payloadB64, sigB64] = token.split('.');
  const key = await hmacKey(secret);
  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    base64UrlToBuf(sigB64),
    new TextEncoder().encode(payloadB64)
  );
  if (!valid) return null;
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlToBuf(payloadB64)));
  } catch (e) {
    return null;
  }
  if (!payload.exp || Date.now() / 1000 > payload.exp) return null;
  return payload;
}

function timingSafeEqual(a, b) {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) diff |= aBytes[i] ^ bBytes[i];
  return diff === 0;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(origin) });
    }

    if (url.pathname === '/content' && request.method === 'GET') {
      const stored = await env.CONTENT_KV.get(KV_KEY);
      if (!stored) return json(null, { status: 200 }, origin);
      return json(JSON.parse(stored), { status: 200 }, origin);
    }

    if (url.pathname === '/login' && request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch (e) {
        return json({ error: 'bad request' }, { status: 400 }, origin);
      }
      if (!env.ADMIN_PASSWORD || !timingSafeEqual(String(body.password || ''), env.ADMIN_PASSWORD)) {
        return json({ error: 'unauthorized' }, { status: 401 }, origin);
      }
      const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
      const token = await signToken({ exp }, env.SESSION_SECRET);
      return json({ token, expiresIn: TOKEN_TTL_SECONDS }, { status: 200 }, origin);
    }

    if (url.pathname === '/content' && request.method === 'PUT') {
      const authHeader = request.headers.get('Authorization') || '';
      const token = authHeader.replace(/^Bearer\s+/i, '');
      const payload = await verifyToken(token, env.SESSION_SECRET);
      if (!payload) return json({ error: 'unauthorized' }, { status: 401 }, origin);

      let body;
      try {
        body = await request.json();
      } catch (e) {
        return json({ error: 'bad request' }, { status: 400 }, origin);
      }
      await env.CONTENT_KV.put(KV_KEY, JSON.stringify(body));
      return json({ ok: true }, { status: 200 }, origin);
    }

    return json({ error: 'not found' }, { status: 404 }, origin);
  },
};
