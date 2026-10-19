import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { submissionFrom, deliverSubmission } from '../src/submissions.js';

const params = {
  mr_submission_id: 'call-1234567890123456', mr_started_at: '2026-10-19T19:00:00Z',
  caller: '0501234567', extension: '/2',
  mr_elapsed:'5', mr_term:'25', mr_amount:'100000'
};
const env = {
  SHEETS_WEBHOOK_URL:'https://script.google.com/macros/s/test/exec',
  SHEETS_SHARED_SECRET:'shared-secret-123456789012345678'
};
test('submission maps answers and rejects incomplete or impossible data', () => {
  const lead = submissionFrom(params);
  assert.equal(lead.savings, 40000);
  assert.equal(lead.caller, '0501234567');
  assert.equal(submissionFrom({ ...params, mr_amount:'' }), null);
  assert.equal(submissionFrom({ ...params, mr_term:'2' }), null);
});

test('delivery retries, accepts id acknowledgement and never logs sensitive fields', async () => {
  const lead = submissionFrom(params);
  let attempts = 0;
  const logs = [];
  const old = console.log;
  console.log = line => logs.push(line);
  try {
    const fetcher = async (url, options) => {
      attempts++;
      assert.equal(JSON.parse(options.body).secret, env.SHEETS_SHARED_SECRET);
      return attempts === 1 ? new Response('unavailable', {status:503})
        : Response.json({ok:true,id:lead.id});
    };
    assert.equal(await deliverSubmission(lead,env,fetcher,async()=>{}),true);
    assert.equal(attempts,2);
    assert.ok(logs.some(s => JSON.parse(s).event === 'sheets_saved'));
    const output = logs.join('\n');
    assert.ok(!output.includes(params.caller));
    assert.ok(!output.includes(env.SHEETS_SHARED_SECRET));
    assert.ok(!output.includes('100000'));
  } finally { console.log = old; }
});

test('HTML response and rejected Google payload are failures, not saved rows', async () => {
  const lead = submissionFrom(params);
  let tries=0;
  const old=console.log;const logs=[];console.log=s=>logs.push(s);
  try {
    assert.equal(await deliverSubmission(lead,env,async()=>{tries++;return new Response('<html>login</html>');},async()=>{}),false);
    assert.equal(tries,3);
    assert.ok(logs.some(s=>JSON.parse(s).code==='NON_JSON_RESPONSE'));
    assert.equal(await deliverSubmission(lead,env,async()=>Response.json({ok:false,code:'AUTH_FAILED'}),async()=>{}),false);
    assert.ok(logs.some(s=>JSON.parse(s).code==='AUTH_FAILED'));
    assert.ok(!logs.some(s=>JSON.parse(s).event==='sheets_saved'));
  } finally {console.log=old;}
});

test('Apps Script saves one row, deduplicates callbacks and verifies secrets', () => {
  const rows=[];let locked=false;
  const headers=['מזהה פנייה','תאריך ושעה','טלפון המתקשר','שלוחה','לפני כמה שנים נלקחה','תקופת המשכנתא המקורית','סכום המשכנתא המקורי','שנים שנותרו','אומדן חיסכון','הערות'];
  const sheet={
    getLastRow:()=>rows.length+1,getMaxRows:()=>1000,
    getFilter:()=>null,
    getRange:(r,c,n,w)=>({
      getValues:()=>[headers],
      createTextFinder:id=>({matchEntireCell:()=>({findNext:()=>rows.some(row=>row[0]===id)?{}:null})}),
      setNumberFormat:()=>{},setValues:value=>{rows.push(value[0]);}
    })
  };
  const context=vm.createContext({
    console:{log:()=>{},error:()=>{}},
    PropertiesService:{getScriptProperties:()=>({getProperty:()=>env.SHEETS_SHARED_SECRET})},
    LockService:{getScriptLock:()=>({waitLock:()=>{locked=true;},hasLock:()=>locked,releaseLock:()=>{locked=false;}})},
    SpreadsheetApp:{openById:()=>({getSheetByName:()=>sheet}),flush:()=>{}},
    ContentService:{MimeType:{JSON:'json'},createTextOutput:body=>({setMimeType:()=>JSON.parse(body)})}
  });
  vm.runInContext(readFileSync(new URL('../google-apps-script/Code.gs',import.meta.url),'utf8'),context);
  const lead=submissionFrom(params);
  const event=secret=>({postData:{contents:JSON.stringify({secret,lead})}});
  assert.equal(context.doPost(event('wrong')).code,'AUTH_FAILED');
  assert.equal(rows.length,0);
  assert.equal(context.doPost(event(env.SHEETS_SHARED_SECRET)).ok,true);
  assert.equal(context.doPost(event(env.SHEETS_SHARED_SECRET)).duplicate,true);
  assert.equal(rows.length,1);
  assert.equal(rows[0][8],40000);
  assert.equal(locked,false);
});
