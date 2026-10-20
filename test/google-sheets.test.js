import test from 'node:test';
import assert from 'node:assert/strict';
import {GoogleSheetsClient,SheetsWriter,SHEET_HEADERS,leadCells,shouldReplaceRow} from '../src/google-sheets.js';

const lead={id:'sheet-test-1234567890123',receivedAt:'2026-10-20T10:00:00Z',caller:'0500000000',extension:'/1',elapsed:5,term:25,amount:100000,remaining:20,savings:40000,status:'השלים פרטים',statusRank:2,stage:'offer'};
const rowValues=lead=>leadCells(lead).map(c=>c.userEnteredValue.numberValue??c.userEnteredValue.stringValue);
test('sheet cells preserve phone and external strings as literals, local date and missing values',()=>{
 const cells=leadCells({...lead,caller:'=1+1'});
 assert.equal(cells[2].userEnteredValue.stringValue,'=1+1');
 assert.ok(!cells[2].userEnteredValue.formulaValue);
 assert.equal(cells[8].userEnteredValue.numberValue,40000);
 assert.equal(cells[1].userEnteredValue.numberValue,Date.UTC(2026,9,20,13)/86400000+25569);
 assert.equal(leadCells({...lead,amount:null,savings:null})[6].userEnteredValue.stringValue,'');
 assert.equal(shouldReplaceRow(rowValues({...lead,statusRank:3}),lead),false);
});
test('direct client writes one row and upgrades status without duplicates or downgrades',async()=>{
 const client=new GoogleSheetsClient({GOOGLE_SHEET_ID:'test'});const rows=[SHEET_HEADERS];
 client.api=async(path,method,body)=>{
  if(path.startsWith('?fields'))return {sheets:[{properties:{sheetId:1,title:'פניות',gridProperties:{rowCount:1000}}}]};
  if(path===':batchUpdate'){
   for(const r of body.requests){if(r.updateCells){const u=r.updateCells;rows[u.range.startRowIndex]=u.rows[0].values.map(c=>c.userEnteredValue.numberValue??c.userEnteredValue.stringValue);}}
   return {};
  }
  const range=decodeURIComponent(path.split('/values/')[1].split('?')[0]);
  if(range.endsWith('A1:M1'))return {values:[rows[0]]};
  if(range.endsWith('A2:A1000'))return {values:rows.slice(1).map(r=>[r[0]])};
  if(range.endsWith('A2:M2'))return {values:[rows[1]]};
  throw new Error('Unexpected range '+range);
 };
 assert.equal((await client.upsert(lead)).row,2);
 assert.equal((await client.upsert(lead)).duplicate,true);
 assert.equal((await client.upsert({...lead,statusRank:3,status:'ביקש לחזור אליו',stage:'callback_requested'})).duplicate,false);
 assert.equal(rows.length,2);
 assert.equal(rows[1][10],'ביקש לחזור אליו');
 assert.equal((await client.upsert(lead)).duplicate,true);
});
test('durable writer retains failures across instance restart and retries without status regression',async()=>{
 const data=new Map();let alarm=null;
 const storage={get:async k=>data.get(k),put:async(k,v)=>data.set(k,v),delete:async k=>data.delete(k),getAlarm:async()=>alarm,setAlarm:async a=>{alarm=a;},deleteAlarm:async()=>{alarm=null;},list:async({prefix,limit})=>new Map([...data].filter(([k])=>k.startsWith(prefix)).slice(0,limit))};
 const ctx={storage};let writer=new SheetsWriter(ctx,{});
 const send=l=>writer.fetch(new Request('https://internal',{method:'POST',body:JSON.stringify(l)}));
 await send(lead);await send({...lead,statusRank:3,status:'ביקש לחזור אליו'});await send(lead);
 writer.client.upsert=async()=>{throw Object.assign(new Error('secret details'),{code:'SHEETS_PERMISSION_DENIED',status:403});};
 await writer.alarm();assert.equal(data.size,1);assert.ok(alarm);
 writer=new SheetsWriter(ctx,{});let received;
 writer.client.upsert=async l=>{received=l;return {row:2};};
 await writer.alarm();assert.equal(received.statusRank,3);assert.equal(data.size,0);assert.equal(alarm,null);
});
test('token exchange signs a real JWT and caches the returned access token',async()=>{
 const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 const privateKey=await crypto.subtle.exportKey('pkcs8',keys.privateKey);
 const pem='-----BEGIN PRIVATE KEY-----\n'+Buffer.from(privateKey).toString('base64')+'\n-----END PRIVATE KEY-----';
 let calls=0;
 const client=new GoogleSheetsClient({GOOGLE_SERVICE_ACCOUNT_JSON:JSON.stringify({type:'service_account',client_email:'test@example.com',private_key:pem})},async(url,options)=>{
  calls++;const jwt=new URLSearchParams(options.body).get('assertion');const [a,b,sig]=jwt.split('.');
  assert.equal(await crypto.subtle.verify('RSASSA-PKCS1-v1_5',keys.publicKey,Buffer.from(sig,'base64url'),new TextEncoder().encode(a+'.'+b)),true);
  assert.equal(JSON.parse(Buffer.from(b,'base64url')).scope,'https://www.googleapis.com/auth/spreadsheets');
  return Response.json({access_token:'mock-token',expires_in:3600});
 });
 assert.equal(await client.accessToken(),'mock-token');assert.equal(await client.accessToken(),'mock-token');assert.equal(calls,1);
});
