import { logEvent } from './logger.js';

export const SHEET_HEADERS = ['מזהה פנייה','תאריך ושעה','טלפון המתקשר','שלוחה','לפני כמה שנים נלקחה','תקופת המשכנתא המקורית','סכום המשכנתא המקורי','שנים שנותרו','אומדן חיסכון','הערות','סטטוס','שלב אחרון','דירוג סטטוס'];
const STAGES = {mr_elapsed:'מועד לקיחת המשכנתא',mr_term:'תקופת המשכנתא',mr_amount:'סכום המשכנתא',offer:'סיום השאלון',callback_requested:'בקשת חזרה'};
const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
const encoded = value => b64url(new TextEncoder().encode(JSON.stringify(value)));

export function leadCells(lead) {
  const date = new Date(lead.receivedAt);
  // Store actual Sheets date serial in the workbook's local timezone.
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date).map(p=>[p.type,p.value]));
  const serial = Date.UTC(+parts.year,+parts.month-1,+parts.day,+parts.hour,+parts.minute,+parts.second)/86400000+25569;
  return [lead.id,serial,lead.caller,lead.extension,lead.elapsed,lead.term,lead.amount,lead.remaining,lead.savings,
    lead.savings === null ? 'הנתונים חלקיים.' : 'אומדן בלבד לפי המודל שנקבע.',lead.status,STAGES[lead.stage]||lead.stage,lead.statusRank]
    .map(v => v === null || v === undefined ? {userEnteredValue:{stringValue:''}} : {userEnteredValue:typeof v === 'number'?{numberValue:v}:{stringValue:String(v)}});
}

export function shouldReplaceRow(existing, lead) {
  if (!existing) return true;
  const rank = Number(existing[12]) || (existing[6] !== '' && existing[6] !== undefined ? 2 : 1);
  const count = values => values.filter(v=>v !== '' && v !== null && v !== undefined).length;
  return lead.statusRank > rank || (lead.statusRank === rank && count([lead.elapsed,lead.term,lead.amount]) > count(existing.slice(4,7)));
}

export class GoogleSheetsClient {
  constructor(env, fetcher = fetch) { this.env=env; this.fetcher=fetcher; this.token=null; }
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
        logEvent('sheets_failed',lead.id,{code:allowed.includes(error?.code)?error.code:'NETWORK_OR_RUNTIME_ERROR',status:error?.status||0});
        break;
      }
    }
    const more=await this.ctx.storage.list({prefix:'pending:',limit:1});
    if(!more.size)await this.ctx.storage.deleteAlarm();
  });}
}

export async function queueSheetLead(lead,env){
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
