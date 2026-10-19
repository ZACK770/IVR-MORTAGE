import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
const env = { IVR_PATH_SECRET: 'test-secret-12345678901234567890' };
const base = 'https://example.workers.dev/ivr/' + env.IVR_PATH_SECRET;
const invoke = (query = '', options) => worker.fetch(new Request(base + query, options), env);

test('Worker: complete phone call through real Request/Response objects', async () => {
  const p = new URLSearchParams();
  for (const [name, answer] of [['mr_elapsed','5'],['mr_term','25'],['mr_amount','100000']]) {
    const r = invoke('?' + p);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /application\/json/);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    const module = await r.json();
    assert.equal(module.name, name);
    p.set(name, answer);
  }
  const result = await invoke('?' + p).json();
  assert.equal(result.type, 'simpleMessage');
  assert.ok(result.files.some(f => Number(f.number) === 40000));
  for (const [key, value] of Object.entries(result.addParams)) p.set(key, value);
  assert.deepEqual(await invoke('?' + p).json(), { type: 'hangup' });
});

test('Worker: fail closed without secret and with unknown path', async () => {
  assert.equal(worker.fetch(new Request(base), {}).status, 404);
  assert.equal(worker.fetch(new Request('https://example.workers.dev/'), {}).status, 200);
  assert.equal(worker.fetch(new Request('https://example.workers.dev/ivr'), env).status, 404);
  assert.equal(worker.fetch(new Request('https://example.workers.dev/healthz'), env).status, 200);
});

test('Worker: rejects duplicate fields, POST and oversized URL', () => {
  assert.equal(invoke('?mr_elapsed=1&mr_elapsed=2').status, 400);
  assert.equal(invoke('', { method: 'POST' }).status, 405);
  assert.equal(invoke('?x=' + 'a'.repeat(8200)).status, 414);
});

test('Worker: interleaved calls remain isolated', async () => {
  const a = '?mr_elapsed=5&mr_term=25&mr_amount=100000';
  const b = '?mr_elapsed=10&mr_term=20&mr_amount=500000';
  const results = await Promise.all([invoke(a).json(), invoke(b).json(), invoke(a).json()]);
  for (const [i, value] of [40000, 100000, 40000].entries()) {
    assert.ok(results[i].files.some(f => Number(f.number) === value));
  }
});
