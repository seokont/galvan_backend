import { loadEnvFile } from 'node:process';
import assert from 'node:assert/strict';
loadEnvFile('.env');
const base = process.env.ADMIN_TEST_FRONTEND_URL || 'http://127.0.0.1:3000';
const credentials = {
  email: process.env.ADMIN_EMAIL,
  password: process.env.ADMIN_INITIAL_PASSWORD,
};
let cookie;
async function request(method, path, body, origin = base, sendCookie = true) {
  const headers = {};
  if (origin) headers.Origin = origin;
  if (sendCookie && cookie) headers.Cookie = cookie;
  if (body) headers['Content-Type'] = 'application/json';
  return fetch(base + '/api/admin/' + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}
try {
  assert.equal((await request('GET', 'products')).status, 401);
  assert.equal(
    (await request('POST', 'auth/login', credentials, 'https://other.example'))
      .status,
    403,
  );
  assert.equal(
    (await request('POST', 'auth/login', credentials, null)).status,
    403,
  );
  const login = await request('POST', 'auth/login', credentials);
  assert.equal(login.status, 200);
  const loginData = await login.json();
  assert.ok(loginData.admin);
  assert.equal(loginData.token, undefined);
  const header = login.headers.get('set-cookie');
  assert.match(header, /HttpOnly/i);
  assert.match(header, /SameSite=Strict/i);
  cookie = header.split(';')[0];
  const session = await request('GET', 'auth/session');
  assert.equal(session.status, 200);
  assert.equal(session.headers.get('cache-control'), 'no-store');
  const list = await request('GET', 'products?limit=1');
  assert.equal(list.status, 200);
  const data = await list.json();
  assert.equal(data.items.length, 1);
  assert.equal(
    (
      await request(
        'PATCH',
        'products/' + data.items[0].id,
        { version: 0, changes: { name: 'must not save' } },
        'https://other.example',
      )
    ).status,
    403,
  );
  const logout = await request('POST', 'auth/logout', {});
  assert.equal(logout.status, 201);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/i);
  const revoked = await request('GET', 'auth/session');
  assert.equal(revoked.status, 401);
  assert.match(revoked.headers.get('set-cookie'), /Max-Age=0/i);
  console.log(
    'Admin frontend proxy passed: Origin checks, HttpOnly cookie, no token in JSON, authorized list, logout/revocation.',
  );
} finally {
  if (cookie) await request('POST', 'auth/logout', {}).catch(() => {});
}
