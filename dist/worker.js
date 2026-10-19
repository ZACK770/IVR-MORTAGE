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
    'ברוכים הבאים למחשבון החיסכון המשוער ממיחזור משכנתא. לפני כמה שנים לקחתם את המשכנתא? הקישו מספר שנים שלמות ובסיום סולמית. אם טרם חלפה שנה, הקישו אפס וסולמית.',
    'לכמה שנים נלקחה המשכנתא במקור? הקישו מספר שנים בין אחת לארבעים ובסיום סולמית.',
    'מה היה סכום המשכנתא המקורי בשקלים? הקישו את הסכום המלא בספרות בלבד ובסיום סולמית. לדוגמה, עבור חצי מיליון שקלים, הקישו חמש אפס אפס אפס אפס אפס וסולמית.'
  ];
  return {
    type: 'getDTMF', name: FIELDS[index],
    files: [text(prefix + prompts[index])],
    min: 1, max: index === 2 ? 8 : 2, timeout: 10,
    skipKey: '#', skipValue: 'ERROR', confirmType: 'number'
  };
}

function retry(index, params, message) {
  const failures = (integer(params.mr_failures, 0, MAX_FAILURES) ?? 0) + 1;
  const removeParams = FIELDS.slice(index);
  if (failures >= MAX_FAILURES) return {
    type: 'simpleMessage',
    files: [text('לא הצלחנו לקבל נתונים תקינים. אנא התקשרו שוב ונסו מחדש. תודה ולהתראות.')],
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
  if (params.PBXcallStatus === 'HANGUP') return { type: 'hangup' };
  if (params.mr_stage === 'done') return { type: 'hangup' };
  const elapsed = integer(params.mr_elapsed, 0, 40);
  if (elapsed === null) return own(params, 'mr_elapsed')
    ? retry(0, params, 'הערך שהוקש אינו תקין. הקישו בין אפס לארבעים שנים.')
    : question(0);

  const term = integer(params.mr_term, 1, 40);
  if (term === null || term < elapsed) return own(params, 'mr_term')
    ? retry(1, params, 'יש להקיש תקופה בין שנה לארבעים שנה, שאינה קצרה מהזמן שכבר חלף.')
    : question(1);

  const amount = integer(params.mr_amount, 1, 99999999);
  if (amount === null) return own(params, 'mr_amount')
    ? retry(2, params, 'סכום המשכנתא אינו תקין. יש להקיש סכום חיובי בספרות בלבד.')
    : question(2);

  if (params.mr_callback === '1') return {
    type: 'goTo', goTo: '2', addParams: { mr_stage: 'callback_requested' }
  };
  if (Object.hasOwn(params, 'mr_callback')) return { type: 'hangup' };
  const { savings } = estimate({ elapsed, term, amount });
  return {
    type: 'getDTMF', name: 'mr_callback', min: 1, max: 1, timeout: 10,
    skipKey: '#', skipValue: 'NO', confirmType: 'no',
    files: [
      text('אומדן החיסכון שלכם הוא'),
      { number: String(savings) },
      text('שקלים. הסכום כפוף לבדיקה. לבדיקה ללא עלות הקש כעת 1.')
    ],
    addParams: { mr_stage: 'offer' }
  };
}

function logEvent(event, id = '', details = {}) {
  const entry = { time: new Date().toISOString(), event };
  if (/^[A-Za-z0-9_-]{16,100}$/.test(id)) entry.id = id;
  for (const key of ['stage', 'code', 'attempt', 'status', 'durationMs']) {
    if (Object.hasOwn(details, key)) entry[key] = details[key];
  }
  console.log(JSON.stringify(entry));
}


function submissionFrom(params) {
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
async function deliverSubmission(lead, env, fetcher = fetch, pause = ms => new Promise(r => setTimeout(r, ms))) {
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


function shouldEmail(params, module) {
  // Send at the choice/exit, not while the savings offer is still playing.
  // A subsequent HANGUP after goTo must not generate another notification.
  if (params.mr_stage === 'callback_requested') return false;
  return module.type === 'goTo' || params.PBXcallStatus === 'HANGUP';
}

function emailContent(lead) {
  const value = v => v === null || v === undefined || v === '' ? 'לא נמסר' : String(v);
  const labels = {mr_elapsed:'שאלה 1 — מועד לקיחת המשכנתא',mr_term:'שאלה 2 — תקופת המשכנתא',mr_amount:'שאלה 3 — סכום המשכנתא',offer:'סיום השאלון',callback_requested:'בקשת חזרה ומעבר לשלוחה 2'};
  const rows = [
    ['סטטוס',lead.status], ['טלפון',lead.caller], ['מועד תחילת השיחה',lead.receivedAt],
    ['שלוחה',lead.extension], ['לפני כמה שנים נלקחה',lead.elapsed],
    ['תקופה מקורית בשנים',lead.term], ['סכום מקורי בשקלים',lead.amount],
    ['שנים שנותרו',lead.remaining], ['אומדן חיסכון בשקלים',lead.savings],
    ['שלב אחרון',labels[lead.stage] || lead.stage], ['מזהה שיחה',lead.id]
  ];
  const escape = v => value(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  return {
    subject: 'פניית משכנתא — ' + lead.status,
    text: rows.map(([k,v])=>k+': '+value(v)).join('\n'),
    html: '<div dir="rtl" lang="he"><h2>פנייה מהמערכת הטלפונית</h2><table>' + rows.map(([k,v])=>'<tr><th align="right">'+escape(k)+'</th><td>'+escape(v)+'</td></tr>').join('')+'</table></div>'
  };
}

async function deliverEmail(lead, env) {
  const address = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;
  if (!env?.EMAIL?.send || !address.test(env.EMAIL_FROM || '') || !address.test(env.EMAIL_TO || '')) {
    logEvent('email_failed', lead.id, {code:'INVALID_EMAIL_CONFIG'});
    return false;
  }
  logEvent('email_attempt',lead.id,{stage:lead.stage});
  try {
    await env.EMAIL.send({from:env.EMAIL_FROM,to:env.EMAIL_TO,...emailContent(lead)});
    // Accepted by Cloudflare; this is not proof of inbox delivery.
    logEvent('email_accepted',lead.id,{stage:lead.stage});
    return true;
  } catch(error) {
    const codes=['E_SENDER_NOT_VERIFIED','E_RECIPIENT_NOT_ALLOWED','E_RECIPIENT_SUPPRESSED','E_SENDER_DOMAIN_NOT_AVAILABLE','E_DELIVERY_FAILED','E_RATE_LIMIT_EXCEEDED','E_DAILY_LIMIT_EXCEEDED','E_INTERNAL_SERVER_ERROR','E_VALIDATION_ERROR'];
    logEvent('email_failed',lead.id,{stage:lead.stage,code:codes.includes(error?.code)?error.code:'SEND_FAILED'});
    return false;
  }
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
  fetch(request, env, ctx) {
    let traceId = '';
    try {
      if (request.url.length > 8192) {
        logEvent('request_rejected', '', { code: 'URL_TOO_LONG' });
        return json({ type: 'hangup' }, 414);
      }
      const url = new URL(request.url);
      if (url.pathname === '/healthz' && request.method === 'GET') {
        return json({ status: 'ok', version: '1.3.0', sheetsConfigured: Boolean(env?.SHEETS_WEBHOOK_URL && env?.SHEETS_SHARED_SECRET), emailConfigured: Boolean(env?.EMAIL?.send && env?.EMAIL_FROM && env?.EMAIL_TO) });
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
      if (lead && env?.SHEETS_WEBHOOK_URL) deliveries.push(deliverSubmission(lead, env));
      if (lead && shouldEmail(params, module)) {
        if (env?.EMAIL?.send) deliveries.push(deliverEmail(lead, env));
        else logEvent('email_skipped', id, { code: 'NOT_CONFIGURED' });
      }
      if (lead && !env?.SHEETS_WEBHOOK_URL && !env?.EMAIL?.send) {
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
