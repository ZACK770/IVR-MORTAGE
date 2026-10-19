import test from 'node:test';
import assert from 'node:assert/strict';
import { estimate, handleCall } from '../src/flow.js';
import { createServer } from '../src/server.js';

test('baseline and proportional estimates', () => {
  assert.deepEqual(estimate({ elapsed: 5, term: 25, amount: 100000 }), { remaining: 20, savings: 40000 });
  assert.equal(estimate({ elapsed: 5, term: 25, amount: 500000 }).savings, 200000);
  assert.equal(estimate({ elapsed: 10, term: 20, amount: 100000 }).savings, 20000);
  assert.equal(estimate({ elapsed: 20, term: 20, amount: 100000 }).savings, 0);
  assert.equal(estimate({ elapsed: 0, term: 1, amount: 101 }).savings, 2);
  assert.throws(() => estimate({ elapsed: 26, term: 25, amount: 100000 }), RangeError);
});

test('full named-answer callback chain, result, then hangup', () => {
  const p = {};
  for (const [name, answer] of [['mr_elapsed','5'], ['mr_term','25'], ['mr_amount','500000']]) {
    const response = handleCall(p);
    assert.equal(response.type, 'getDTMF');
    assert.equal(response.name, name);
    p[name] = answer;
  }
  const result = handleCall(p);
  assert.equal(result.type, 'simpleMessage');
  assert.ok(result.files.some(f => f.number === 200000));
  Object.assign(p, result.addParams);
  assert.deepEqual(handleCall(p), { type: 'hangup' });
});

test('validation rejects malformed values and clears stale downstream answers', () => {
  for (const value of ['', '-1', '2.5', '1e2', ' 5', '41', 'שלום']) {
    const r = handleCall({ mr_elapsed: value, mr_term: '25', mr_amount: '500000' });
    assert.equal(r.name, 'mr_elapsed');
    assert.deepEqual(r.removeParams, ['mr_elapsed','mr_term','mr_amount']);
  }
  const r = handleCall({ mr_elapsed: '20', mr_term: '15' });
  assert.equal(r.name, 'mr_term');
  assert.deepEqual(r.removeParams, ['mr_term', 'mr_amount']);
  assert.equal(handleCall({ mr_elapsed:'0',mr_term:'30',mr_amount:'0' }).name, 'mr_amount');
});

test('invalid attempts terminate after three errors', () => {
  const p = { mr_elapsed: 'bad' };
  for (let i = 0; i < 2; i++) Object.assign(p, handleCall(p).addParams);
  const r = handleCall(p);
  assert.equal(r.type, 'simpleMessage');
  assert.equal(r.addParams.mr_stage, 'done');
  assert.equal(handleCall({ ...p, ...r.addParams }).type, 'hangup');
});

test('completed mortgage announces zero without a false savings claim', () => {
  const r = handleCall({ mr_elapsed: '20', mr_term: '20', mr_amount: '100000' });
  assert.match(r.files[0].text, /אפס/);
});

test('real HTTP: private URL, UTF-8 JSON, no cache, health and invalid requests', async () => {
  const secret = 'a'.repeat(32);
  assert.throws(() => createServer({ production:true }), /IVR_PATH_SECRET/);
  const server = createServer({ production:true, secret });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    assert.equal((await fetch(base + '/healthz')).status, 200);
    assert.equal((await fetch(base + '/ivr')).status, 404);
    const response = await fetch(base + '/ivr/' + secret);
    assert.match(response.headers.get('content-type'), /application\/json/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.json()).name, 'mr_elapsed');
    const final = await fetch(base + '/ivr/' + secret + '?mr_elapsed=5&mr_term=25&mr_amount=100000');
    assert.ok((await final.json()).files.some(f => f.number === 40000));
    assert.equal((await fetch(base + '/ivr/' + secret + '?mr_elapsed=1&mr_elapsed=2')).status, 400);
    assert.equal((await fetch(base + '/ivr/' + secret, { method:'POST' })).status, 405);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
