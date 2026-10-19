import { estimate, integer } from './flow.js';
import { logEvent } from './logger.js';

export function submissionFrom(params) {
  const elapsed = integer(params.mr_elapsed, 0, 40);
  let term = integer(params.mr_term, 1, 40);
  if (elapsed === null || (term !== null && term < elapsed)) term = null;
  const amount = term === null ? null : integer(params.mr_amount, 1, 99999999);
  const complete = elapsed !== null && term !== null && amount !== null;
  if (!complete && params.PBXcallStatus !== 'HANGUP') return null;
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(params.mr_submission_id || '')) return null;
  const result = complete ? estimate({ elapsed, term, amount }) : { remaining: null, savings: null };
  const requested = complete && (params.mr_callback === '1' || params.mr_stage === 'callback_requested');
  const status = requested ? 'ביקש לחזור אליו' : complete ? 'השלים פרטים' : 'נותק באמצע';
  const statusRank = requested ? 3 : complete ? 2 : 1;
  const stage = requested ? 'callback_requested' : complete ? 'offer' : elapsed === null ? 'mr_elapsed' : term === null ? 'mr_term' : 'mr_amount';
  const caller = String(params.PBXphone || params.caller || params.mr_caller || '').slice(0, 40);
  const extension = String(params.PBXextensionPath || params.PBXextensionId || params.extension || '').slice(0, 100);
  const date = new Date(params.mr_started_at || '');
  return {
    id: params.mr_submission_id,
    receivedAt: Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString(),
    caller, extension, elapsed, term, amount, ...result, status, statusRank, stage
  };
}

// Retries are best effort within the request lifetime. The Google endpoint
// deduplicates by id under a script lock, including simultaneous callbacks.
export async function deliverSubmission(lead, env, fetcher = fetch, pause = ms => new Promise(r => setTimeout(r, ms))) {
  const endpoint = env.SHEETS_WEBHOOK_URL || '';
  const secret = env.SHEETS_SHARED_SECRET || '';
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(endpoint) || secret.length < 24) {
    logEvent('sheets_failed', lead.id, { code: 'INVALID_CONFIG' });
    return false;
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const started = Date.now();
    logEvent('sheets_attempt', lead.id, { attempt: attempt + 1 });
    try {
      const response = await fetcher(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ secret, lead }),
        redirect: 'follow',
        signal: AbortSignal.timeout(4500)
      });
      if (!response.ok) {
        logEvent('sheets_retry', lead.id, { code: 'HTTP_ERROR', status: response.status, attempt: attempt + 1 });
      } else {
        let body;
        const responseText = await response.text();
        try { body = JSON.parse(responseText); } catch {
          logEvent('sheets_retry', lead.id, { code: 'NON_JSON_RESPONSE', attempt: attempt + 1 });
        }
        if (body?.ok === true && body.id === lead.id) {
          logEvent('sheets_saved', lead.id, { durationMs: Date.now() - started, attempt: attempt + 1 });
          return true;
        }
        if (body) {
          const allowed = ['CONFIG_MISSING','AUTH_FAILED','INVALID_PAYLOAD','MISSING_SHEET','HEADER_MISMATCH','WRITE_FAILED'];
          logEvent('sheets_retry', lead.id, {
            code: allowed.includes(body.code) ? body.code : 'REJECTED',
            attempt: attempt + 1
          });
        }
      }
    } catch (error) {
      logEvent('sheets_retry', lead.id, {
        code: ['TimeoutError','AbortError'].includes(error?.name) ? 'TIMEOUT' : 'NETWORK_ERROR',
        attempt: attempt + 1
      });
    }
    if (attempt < 2) await pause(500 * (attempt + 1));
  }
  logEvent('sheets_failed', lead.id, { code: 'RETRIES_EXHAUSTED' });
  return false;
}
