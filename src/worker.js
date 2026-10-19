import { handleCall } from './flow.js';

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
