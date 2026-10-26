import { timingSafeEqual } from 'node:crypto';

const OWNER = 'forge-personal-owner';
const WINDOW = 10 * 60 * 1000;
const LIMIT = 5;
const privateHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Authorization' };
const challengeHeaders = { ...privateHeaders, 'WWW-Authenticate': 'Basic realm="Forge", charset="UTF-8"' };
const hash = async value => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
const hex = bytes => Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('');
function setupResponse(hasDB, validPassword) {
  const items = [];
  if (!hasDB) items.push('<li>Keep your D1 database bound as <code>DB</code>.</li>');
  if (!validPassword) items.push('<li>In Pages → Settings → Variables and secrets, add a <strong>Secret</strong> named <code>FORGE_PASSWORD</code>. Choose a unique password or passphrase of 16–256 characters.</li>');
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Forge setup</title><style>body{background:#0b1220;color:#f8fafc;font:18px/1.6 system-ui;margin:0;padding:40px 24px}main{max-width:640px;margin:auto}h1{font-size:36px;color:#c4b5fd}p,li{color:#94a3b8}code{color:#c4b5fd}li{margin:16px 0}</style><main><h1>Forge</h1><h2>Finish your personal setup</h2><ol>${items.join('')}<li>Keep <code>nodejs_compat</code> enabled, then redeploy your Pages project.</li></ol><p>When your browser asks you to sign in, use username <strong>forge</strong> and the password you saved.</p><p>This version does not use Cloudflare Zero Trust. R2 is optional for cloud photo backup.</p></main></html>`, { status: 503, headers: { ...privateHeaders, 'Content-Type': 'text/html; charset=utf-8' } });
}
function credentials(value) {
  if (!value || value.length > 4096 || !/^Basic\s+/i.test(value)) return null;
  try {
    const raw = atob(value.replace(/^Basic\s+/i, ''));
    const text = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(raw, c => c.charCodeAt(0)));
    const index = text.indexOf(':');
    return index < 0 ? null : { username: text.slice(0, index), password: text.slice(index + 1) };
  } catch { return null; }
}
export function createPersonalForgeWorker(app, staticPaths) {
  const assets = new Set(staticPaths), initialized = new WeakMap();
  async function initialize(db) {
    if (!initialized.has(db)) {
      const promise = db.batch([
        db.prepare('CREATE TABLE IF NOT EXISTS training_records (user_id text NOT NULL, record_key text NOT NULL, kind text NOT NULL, payload text NOT NULL, updated text NOT NULL, PRIMARY KEY (user_id, record_key))'),
        db.prepare('CREATE INDEX IF NOT EXISTS records_user_kind ON training_records (user_id, kind)'),
        db.prepare('CREATE TABLE IF NOT EXISTS forge_login_limits (client_key text PRIMARY KEY, failures integer NOT NULL, reset_at integer NOT NULL)'),
      ]);
      initialized.set(db, promise);
      promise.catch(() => initialized.delete(db));
    }
    await initialized.get(db);
  }
  return {
    async fetch(request, env, ctx) {
      const url = new URL(request.url);
      if ((request.method === 'GET' || request.method === 'HEAD') && assets.has(url.pathname)) return env.ASSETS.fetch(request);
      const password = typeof env.FORGE_PASSWORD === 'string' ? env.FORGE_PASSWORD : '';
      if (!env.DB || password.length < 16 || password.length > 256) return setupResponse(!!env.DB, password.length >= 16 && password.length <= 256);
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
        const origin = request.headers.get('origin');
        if ((origin && origin !== url.origin) || request.headers.get('sec-fetch-site') === 'cross-site') return new Response('Invalid origin', { status: 403, headers: privateHeaders });
      }
      const authorization = request.headers.get('authorization');
      if (!authorization) return new Response('Sign in to Forge using username forge and your own Forge password.', { status: 401, headers: challengeHeaders });
      try {
        await initialize(env.DB);
        const client = hex(await hash(password + '\0' + (request.headers.get('cf-connecting-ip') ?? 'unknown')));
        const now = Date.now();
        const previous = await env.DB.prepare('SELECT failures, reset_at FROM forge_login_limits WHERE client_key = ?').bind(client).first();
        if (previous && previous.reset_at > now && previous.failures >= LIMIT) return new Response('Too many incorrect sign-in attempts. Try again in a few minutes.', { status: 429, headers: { ...privateHeaders, 'Retry-After': String(Math.max(1, Math.ceil((previous.reset_at - now) / 1000))) } });
        const supplied = credentials(authorization);
        const [actual, expected] = await Promise.all([hash(supplied?.password ?? ''), hash(password)]);
        if (!supplied || !timingSafeEqual(actual, expected) || supplied.username !== 'forge') {
          await env.DB.prepare('INSERT INTO forge_login_limits (client_key, failures, reset_at) VALUES (?, 1, ?) ON CONFLICT(client_key) DO UPDATE SET failures = CASE WHEN reset_at <= ? THEN 1 ELSE failures + 1 END, reset_at = CASE WHEN reset_at <= ? THEN ? ELSE reset_at END').bind(client, now + WINDOW, now, now, now + WINDOW).run();
          return new Response('Incorrect Forge username or password.', { status: 401, headers: challengeHeaders });
        }
        if (previous) await env.DB.prepare('DELETE FROM forge_login_limits WHERE client_key = ?').bind(client).run();
        if (url.pathname === '/signin-with-chatgpt' || url.pathname === '/callback') return Response.redirect(url.origin + '/', 302);
        const headers = new Headers(request.headers);
        headers.delete('authorization');
        for (const name of [...headers.keys()]) if (name.startsWith('oai-authenticated-user-')) headers.delete(name);
        headers.set('oai-authenticated-user-id', OWNER);
        headers.set('oai-authenticated-user-email', 'owner@forge.local');
        const response = await app.fetch(new Request(request, { headers }), env, ctx);
        const output = new Headers(response.headers);
        for (const [name, value] of Object.entries(privateHeaders)) output.set(name, value);
        return new Response(response.body, { status: response.status, statusText: response.statusText, headers: output });
      } catch {
        return new Response('Forge could not open training storage. Check the DB binding and retry. Your device workout data is retained.', { status: 503, headers: privateHeaders });
      }
    },
  };
}
