const FIELDS = ['mr_elapsed', 'mr_term', 'mr_amount'];
const MAX_FAILURES = 3;
const text = (value) => ({ text: value });
const own = (p, key) => Object.hasOwn(p, key);

function integer(raw, min, max) {
  if (typeof raw !== 'string' || !/^[0-9]+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : null;
}

function estimate({ elapsed, term, amount }) {
  if (!Number.isInteger(elapsed) || elapsed < 0 || !Number.isInteger(term) ||
      term < 1 || term > 40 || elapsed > term ||
      !Number.isInteger(amount) || amount < 1 || amount > 99999999) {
    throw new RangeError('Invalid mortgage inputs');
  }
  const remaining = term - elapsed;
  return { remaining, savings: Math.round(amount * remaining / 50) };
}

function question(index, prefix = '') {
  const prompts = [
    '������ ����� ������� ������� ������ ������� ������. ���� ��� ���� ����� �� �������? ����� ���� ���� ����� ������ ������. �� ��� ���� ���, ����� ��� �������.',
    '���� ���� ����� ������� �����? ����� ���� ���� ��� ��� ������� ������ ������.',
    '�� ��� ���� ������� ������ ������? ����� �� ����� ���� ������ ���� ������ ������. ������, ���� ��� ������ �����, ����� ��� ��� ��� ��� ��� ��� �������.'
  ];
  return {
    type: 'getDTMF', name: FIELDS[index],
    files: [text(prefix + prompts[index])],
    min: 1, max: index === 2 ? 8 : 2, timeout: 10
  };
}

function retry(index, params, message) {
  const failures = (integer(params.mr_failures, 0, MAX_FAILURES) ?? 0) + 1;
  const removeParams = FIELDS.slice(index);
  if (failures >= MAX_FAILURES) return {
    type: 'simpleMessage',
    files: [text('�� ������ ���� ������ ������. ��� ������ ��� ���� ����. ���� ��������.')],
    addParams: { mr_stage: 'done' }, removeParams
  };
  return {
    ...question(index, message + ' '),
    addParams: { mr_failures: String(failures) }, removeParams
  };
}

// Technoline resends named answers with paramsMode=chain.
// No memory, database, caller number, or session cookie is needed.
function handleCall(params) {
  if (params.mr_stage === 'done') return { type: 'hangup' };
  const elapsed = integer(params.mr_elapsed, 0, 40);
  if (elapsed === null) return own(params, 'mr_elapsed')
    ? retry(0, params, '���� ����� ���� ����. ����� ��� ��� ������� ����.')
    : question(0);

  const term = integer(params.mr_term, 1, 40);
  if (term === null || term < elapsed) return own(params, 'mr_term')
    ? retry(1, params, '�� ����� ����� ��� ��� ������� ���, ����� ���� ����� ���� ���.')
    : question(1);

  const amount = integer(params.mr_amount, 1, 99999999);
  if (amount === null) return own(params, 'mr_amount')
    ? retry(2, params, '���� ������� ���� ����. �� ����� ���� ����� ������ ����.')
    : question(2);

  const { remaining, savings } = estimate({ elapsed, term, amount });
  const files = remaining === 0
    ? [text('��� ������� ������, ����� ������� �������, ���� ����� ������� ������� ��� ��� �����. ���� ��������.')]
    : [
      text('��� ������� ������, ���� ����� ������ ������ ���'),
      { number: remaining },
      text('������ ������� ������� ������� ���'),
      { number: savings },
      text('�����. ��� ����� ����, ��� ���� ���� ������ �� ����� ������ ������ ������. ������� ����� ����� ����� ����� �� ���� �������, ������� ��������. ���� ��������.')
    ];
  return { type: 'simpleMessage', files, addParams: { mr_stage: 'done' } };
}



function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...extraHeaders
    }
  });
}

export default {
  fetch(request, env) {
    try {
      if (request.url.length > 8192) return json({ type: 'hangup' }, 414);
      const url = new URL(request.url);
      if (url.pathname === '/healthz' && request.method === 'GET') {
        return json({ status: 'ok' });
      }
      const secret = env?.IVR_PATH_SECRET || '';
      if (!/^[A-Za-z0-9_-]{24,}$/.test(secret)) {
        return json({ type: 'hangup' }, 503);
      }
      if (url.pathname !== '/ivr/' + secret) return json({ type: 'hangup' }, 404);
      if (request.method !== 'GET') return json({ type: 'hangup' }, 405, { Allow: 'GET' });
      const params = Object.create(null);
      for (const [key, value] of url.searchParams) {
        if (Object.hasOwn(params, key)) return json({ type: 'hangup' }, 400);
        params[key] = value;
      }
      return json(handleCall(params));
    } catch {
      return json({ type: 'hangup' }, 500);
    }
  }
};
