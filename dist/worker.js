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
    type: 'goTo', extensionPathChange: '/2', addParams: { mr_stage: 'callback_requested' }
  };
  if (Object.hasOwn(params, 'mr_callback')) return { type: 'hangup' };
  const { savings } = estimate({ elapsed, term, amount });
  return {
    type: 'simpleMenu', name: 'mr_callback', enabledKeys: '1', times: 2, timeout: 10,
    errorReturn: 'NO', setMusic: 'no',
    files: [
      text('אומדן החיסכון שלכם הוא'),
      { number: String(savings) },
      text('שקלים. הסכום כפוף לבדיקה. לבדיקה מקצועית על ידי נציג, הקישו 1.')
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


const SHEET_HEADERS = ['מזהה פנייה','תאריך ושעה','טלפון המתקשר','שלוחה','לפני כמה שנים נלקחה','תקופת המשכנתא המקורית','סכום המשכנתא המקורי','שנים שנותרו','אומדן חיסכון','הערות','סטטוס','שלב אחרון','דירוג סטטוס'];
const STAGES = {mr_elapsed:'מועד לקיחת המשכנתא',mr_term:'תקופת המשכנתא',mr_amount:'סכום המשכנתא',offer:'סיום השאלון',callback_requested:'בקשת חזרה'};
const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
const encoded = value => b64url(new TextEncoder().encode(JSON.stringify(value)));

function leadCells(lead) {
  const date = new Date(lead.receivedAt);
  // Store actual Sheets date serial in the workbook's local timezone.
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date).map(p=>[p.type,p.value]));
  const serial = Date.UTC(+parts.year,+parts.month-1,+parts.day,+parts.hour,+parts.minute,+parts.second)/86400000+25569;
  return [lead.id,serial,lead.caller,lead.extension,lead.elapsed,lead.term,lead.amount,lead.remaining,lead.savings,
    lead.savings === null ? 'הנתונים חלקיים.' : 'אומדן בלבד לפי המודל שנקבע.',lead.status,STAGES[lead.stage]||lead.stage,lead.statusRank]
    .map(v => v === null || v === undefined ? {userEnteredValue:{stringValue:''}} : {userEnteredValue:typeof v === 'number'?{numberValue:v}:{stringValue:String(v)}});
}

function shouldReplaceRow(existing, lead) {
  if (!existing) return true;
  const rank = Number(existing[12]) || (existing[6] !== '' && existing[6] !== undefined ? 2 : 1);
  const count = values => values.filter(v=>v !== '' && v !== null && v !== undefined).length;
  return lead.statusRank > rank || (lead.statusRank === rank && count([lead.elapsed,lead.term,lead.amount]) > count(existing.slice(4,7)));
}

class GoogleSheetsClient {
  constructor(env, fetcher = (url, options) => fetch(url, options)) { this.env=env; this.fetcher=fetcher; this.token=null; }
  async accessToken() {
    if (this.token && this.token.expires > Date.now()+60000) return this.token.value;
    const sa=JSON.parse(this.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    if (sa.type !== 'service_account' || !sa.client_email || !sa.private_key) throw Object.assign(new Error(),{code:'GOOGLE_CREDENTIALS_INVALID'});
    const now=Math.floor(Date.now()/1000);
    const signing=encoded({alg:'RS256',typ:'JWT',kid:sa.private_key_id})+'.'+encoded({iss:sa.client_email,scope:'https://www.googleapis.com/auth/spreadsheets',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600});
    const pem=sa.private_key.replace(/-----[^-]+-----/g,'').replace(/\s/g,'');
    const key=await crypto.subtle.importKey('pkcs8',Uint8Array.from(atob(pem),c=>c.charCodeAt(0)),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
    const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(signing));
    const response=await this.fetcher('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:signing+'.'+b64url(new Uint8Array(signature))}),signal:AbortSignal.timeout(10000)});
    if (!response.ok) throw Object.assign(new Error(),{code:'GOOGLE_AUTH_FAILED',status:response.status});
    const body=await response.json();
    if (!body.access_token) throw Object.assign(new Error(),{code:'GOOGLE_AUTH_FAILED'});
    this.token={value:body.access_token,expires:Date.now()+Math.min(Number(body.expires_in)||3600,3600)*1000};
    return body.access_token;
  }
  async api(path,method='GET',body) {
    const token=await this.accessToken();
    const response=await this.fetcher('https://sheets.googleapis.com/v4/spreadsheets/'+this.env.GOOGLE_SHEET_ID+path,{method,headers:{Authorization:'Bearer '+token,'content-type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(10000)});
    if (!response.ok) {
      if(response.status===401)this.token=null;
      throw Object.assign(new Error(),{code:response.status===403?'SHEETS_PERMISSION_DENIED':response.status===429?'SHEETS_RATE_LIMIT':'SHEETS_API_ERROR',status:response.status});
    }
    return response.json();
  }
  async upsert(lead) {
    const name=this.env.GOOGLE_SHEET_TAB || 'פניות';
    const meta=await this.api('?fields=sheets.properties');
    const sheet=meta.sheets.find(s=>s.properties.title===name)?.properties;
    if(!sheet)throw Object.assign(new Error(),{code:'MISSING_SHEET'});
    const a1="'"+name.replace(/'/g,"''")+"'!";
    const read=await this.api('/values/'+encodeURIComponent(a1+'A1:M1'));
    const headers=read.values?.[0]||[];
    if(SHEET_HEADERS.some((h,i)=>h!==headers[i]))throw Object.assign(new Error(),{code:'HEADER_MISMATCH'});
    let row=2; let found=false; let last=1;
    // Read only the identity column; never scan an unbounded grid.
    for(let start=2;start<=sheet.gridProperties.rowCount;start+=10000){
      const end=Math.min(start+9999,sheet.gridProperties.rowCount);
      const ids=(await this.api('/values/'+encodeURIComponent(a1+'A'+start+':A'+end))).values||[];
      for(let i=0;i<ids.length;i++){
        if(ids[i]?.[0])last=start+i;
        if(ids[i]?.[0]===lead.id){row=start+i;found=true;break;}
      }
      if(found)break;
    }
    if(found){
      const old=(await this.api('/values/'+encodeURIComponent(a1+'A'+row+':M'+row)+'?valueRenderOption=UNFORMATTED_VALUE')).values?.[0];
      if(!shouldReplaceRow(old,lead))return {row,duplicate:true};
    } else row=last+1;
    const requests=[];
    if(row>sheet.gridProperties.rowCount)requests.push({appendDimension:{sheetId:sheet.sheetId,dimension:'ROWS',length:100}});
    requests.push({updateCells:{range:{sheetId:sheet.sheetId,startRowIndex:row-1,endRowIndex:row,startColumnIndex:0,endColumnIndex:13},rows:[{values:leadCells(lead)}],fields:'userEnteredValue'}});
    await this.api(':batchUpdate','POST',{requests});
    return {row,duplicate:false};
  }
}

// One object per spreadsheet serializes updates and keeps unsent leads across restarts.
export class SheetsWriter {
  constructor(ctx,env){this.ctx=ctx;this.env=env;this.client=new GoogleSheetsClient(env);this.tail=Promise.resolve();}
  serial(fn){const next=this.tail.then(fn);this.tail=next.catch(()=>{});return next;}
  fetch(request){return this.serial(async()=>{
    const lead=await request.json();
    if(!/^[A-Za-z0-9_-]{16,100}$/.test(lead.id||'')||![1,2,3].includes(lead.statusRank))return Response.json({ok:false},{status:400});
    const key='pending:'+lead.id;
    const old=await this.ctx.storage.get(key);
    if(!old || lead.statusRank>old.statusRank || (lead.statusRank===old.statusRank && [lead.elapsed,lead.term,lead.amount].filter(v=>v!==null).length>[old.elapsed,old.term,old.amount].filter(v=>v!==null).length))await this.ctx.storage.put(key,lead);
    if(await this.ctx.storage.getAlarm()===null)await this.ctx.storage.setAlarm(Date.now()+1000);
    logEvent('sheets_queued',lead.id,{stage:lead.stage});
    return Response.json({ok:true,id:lead.id,queued:true});
  });}
  alarm(){return this.serial(async()=>{
    // Arm the next retry before network I/O, so a runtime interruption cannot strand the inbox.
    await this.ctx.storage.setAlarm(Date.now()+60000);
    const pending=await this.ctx.storage.list({prefix:'pending:',limit:10});
    for(const [key,lead]of pending){
      try{
        const result=await this.client.upsert(lead);
        await this.ctx.storage.delete(key);
        logEvent('sheets_saved',lead.id,{stage:lead.stage,code:result.duplicate?'UNCHANGED':'WRITTEN'});
      }catch(error){
        const allowed=['GOOGLE_CREDENTIALS_INVALID','GOOGLE_AUTH_FAILED','SHEETS_PERMISSION_DENIED','SHEETS_RATE_LIMIT','SHEETS_API_ERROR','MISSING_SHEET','HEADER_MISMATCH'];
        const runtimeCode = error?.message === 'Illegal invocation' ? 'FETCH_RECEIVER_ERROR' : error?.name === 'SyntaxError' ? 'GOOGLE_CREDENTIALS_JSON_ERROR' : ['DataError','OperationError'].includes(error?.name) ? 'GOOGLE_KEY_ERROR' : 'NETWORK_OR_RUNTIME_ERROR';
        logEvent('sheets_failed',lead.id,{code:allowed.includes(error?.code)?error.code:runtimeCode,status:error?.status||0});
        break;
      }
    }
    const more=await this.ctx.storage.list({prefix:'pending:',limit:1});
    if(!more.size)await this.ctx.storage.deleteAlarm();
  });}
}

async function queueSheetLead(lead,env){
  try{
    const id=env.SHEETS_WRITER.idFromName(env.GOOGLE_SHEET_ID);
    const response=await env.SHEETS_WRITER.get(id).fetch('https://writer.internal/lead',{method:'POST',body:JSON.stringify(lead)});
    if(!response.ok)throw new Error();
    return true;
  }catch{
    logEvent('sheets_queue_failed',lead.id,{code:'QUEUE_UNAVAILABLE'});
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
        return json({ status: 'ok', version: '1.4.1', sheetsConfigured: Boolean(env?.GOOGLE_SERVICE_ACCOUNT_JSON && env?.GOOGLE_SHEET_ID && env?.SHEETS_WRITER) || Boolean(env?.SHEETS_WEBHOOK_URL && env?.SHEETS_SHARED_SECRET), emailConfigured: Boolean(env?.EMAIL?.send && env?.EMAIL_FROM && env?.EMAIL_TO) });
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
