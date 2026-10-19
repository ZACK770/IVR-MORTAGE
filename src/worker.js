import { handleCall } from './flow.js';
import { submissionFrom, deliverSubmission } from './submissions.js';
import { logEvent } from './logger.js';

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
  fetch(request, env, ctx) {
    let traceId = '';
    try {
      if (request.url.length > 8192) {
        logEvent('request_rejected', '', { code: 'URL_TOO_LONG' });
        return json({ type: 'hangup' }, 414);
      }
      const url = new URL(request.url);
      if (url.pathname === '/healthz' && request.method === 'GET') {
        return json({ status: 'ok', version: '1.2.0', sheetsConfigured: Boolean(env?.SHEETS_WEBHOOK_URL && env?.SHEETS_SHARED_SECRET) });
      }
      const secret = env?.IVR_PATH_SECRET || '';
      if (secret && !/^[A-Za-z0-9_-]{24,}$/.test(secret)) {
        logEvent('request_rejected', '', { code: 'IVR_SECRET_MISSING' });
        return json({ type: 'hangup' }, 503);
      }
      const matches = secret ? url.pathname === '/ivr/' + secret : ['/', '/ivr'].includes(url.pathname);
      if (!matches) {
        logEvent('request_rejected', '', { code: 'PATH_MISMATCH' });
        return json({ type: 'hangup' }, 404);
      }
      if (request.method !== 'GET') return json({ type: 'hangup' }, 405, { Allow: 'GET' });
      const params = Object.create(null);
      for (const [key, value] of url.searchParams) {
        if (Object.hasOwn(params, key)) {
          logEvent('request_rejected', '', { code: 'DUPLICATE_PARAMETER' });
          return json({ type: 'hangup' }, 400);
        }
        params[key] = value;
      }
      const candidateId = params.PBXcallId || params.mr_submission_id || '';
      const id = /^[A-Za-z0-9_-]{16,100}$/.test(candidateId)
        ? candidateId : crypto.randomUUID();
      traceId = id;
      params.mr_submission_id = id;
      params.mr_started_at ||= new Date().toISOString();
      const module = handleCall(params);
      const stage = module.name || (module.type === 'hangup' ? 'hangup' : 'result');
      logEvent('module_returned', id, {
        stage,
        code: module.removeParams ? 'INVALID_INPUT' : 'OK'
      });
      if (module.type !== 'hangup') {
        module.addParams = {
          ...module.addParams,
          mr_submission_id: id,
          mr_started_at: params.mr_started_at
        };
      }
      const lead = submissionFrom(params);
      const response = json(module);
      if (lead && !env.SHEETS_WEBHOOK_URL) logEvent('sheets_skipped', id, { code: 'NOT_CONFIGURED' });
      if (lead && env.SHEETS_WEBHOOK_URL) {
        const delivery = deliverSubmission(lead, env);
        if (ctx?.waitUntil) ctx.waitUntil(delivery);
        else return delivery.then(() => response);
      }
      return response;
    } catch {
      logEvent('request_failed', traceId, { code: 'INTERNAL_ERROR' });
      return json({ type: 'hangup' }, 500);
    }
  }
};
