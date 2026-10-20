import { deliverEmail, shouldEmail } from './email.js';
import { handleCall } from './flow.js';
import { submissionFrom, deliverSubmission } from './submissions.js';
import { logEvent } from './logger.js';
import { queueSheetLead } from './google-sheets.js';
export { SheetsWriter } from './google-sheets.js';

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
        return json({ status: 'ok', version: '1.4.0', sheetsConfigured: Boolean(env?.GOOGLE_SERVICE_ACCOUNT_JSON && env?.GOOGLE_SHEET_ID && env?.SHEETS_WRITER) || Boolean(env?.SHEETS_WEBHOOK_URL && env?.SHEETS_SHARED_SECRET), emailConfigured: Boolean(env?.EMAIL?.send && env?.EMAIL_FROM && env?.EMAIL_TO) });
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
      if (lead) logEvent('lead_ready', id, { stage: lead.stage, code: lead.statusRank === 3 ? 'CALLBACK_REQUESTED' : lead.statusRank === 2 ? 'COMPLETED' : 'ABANDONED' });
      const response = json(module);
      const deliveries = [];
      if (lead && env?.SHEETS_WRITER && env?.GOOGLE_SERVICE_ACCOUNT_JSON && env?.GOOGLE_SHEET_ID) deliveries.push(queueSheetLead(lead,env));
      else if (lead && env?.SHEETS_WEBHOOK_URL) deliveries.push(deliverSubmission(lead, env));
      if (lead && shouldEmail(params, module)) {
        if (env?.EMAIL?.send) deliveries.push(deliverEmail(lead, env));
        else logEvent('email_skipped', id, { code: 'NOT_CONFIGURED' });
      }
      if (lead && !env?.SHEETS_WRITER && !env?.SHEETS_WEBHOOK_URL && !env?.EMAIL?.send) {
        logEvent('delivery_skipped', id, { code: 'NOT_CONFIGURED' });
      }
      if (deliveries.length) {
        const delivery = Promise.allSettled(deliveries);
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
