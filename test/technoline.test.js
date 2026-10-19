import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { submissionFrom } from '../src/submissions.js';

const call = new URLSearchParams({
 PBXcallId:'abcdef1234567890abcdef1234567890abcdef1234',PBXcallStatus:'CALL',
 PBXcallType:'',PBXnum:'020000000',PBXdid:'020000000',
 PBXphone:'0500000000',PBXextensionId:'11148',PBXextensionPath:'/1'
});
test('Technoline actual callback shape: root URL, no secrets, UTF-8, full flow and PBX metadata',async()=>{
 const p=new URLSearchParams(call);
 for(const [field,value]of [['mr_elapsed','5'],['mr_term','25'],['mr_amount','100000']]){
  const response=worker.fetch(new Request('https://example.workers.dev/?'+p),{});
  assert.equal(response.status,200);
  const module=await response.json();
  assert.equal(module.type,'getDTMF');assert.equal(module.name,field);
  assert.match(module.files[0].text,/[א-ת]/);assert.ok(!module.files[0].text.includes('\uFFFD'));
  assert.equal(module.addParams.mr_submission_id,call.get('PBXcallId'));
  for(const [k,v]of Object.entries(module.addParams))p.set(k,v);
  for(const k of module.removeParams||[])p.delete(k);
  p.set(field,value);
 }
 const module=await worker.fetch(new Request('https://example.workers.dev/?'+p),{}).json();
 assert.equal(module.type,'getDTMF');assert.equal(module.name,'mr_callback');assert.ok(module.files.some(f=>Number(f.number) ===40000));
 const lead=submissionFrom(Object.fromEntries(p));
 assert.equal(lead.caller,'0500000000');assert.equal(lead.extension,'/1');
 assert.equal(lead.id,call.get('PBXcallId'));
 for(const [k,v]of Object.entries(module.addParams))p.set(k,v);
 p.set('mr_callback','NO');
 assert.deepEqual(await worker.fetch(new Request('https://example.workers.dev/?'+p),{}).json(),{type:'hangup'});
});
test('Technoline invalid term repeats second question; health reports version',async()=>{
 const p=new URLSearchParams(call);p.set('mr_elapsed','5');p.set('mr_term','2');
 const module=await worker.fetch(new Request('https://example.workers.dev/?'+p),{}).json();
 assert.equal(module.name,'mr_term');assert.deepEqual(module.removeParams,['mr_term','mr_amount']);
 const health=await worker.fetch(new Request('https://example.workers.dev/healthz'),{}).json();
 assert.equal(health.version,'1.3.0');assert.equal(health.sheetsConfigured,false);
});

test('Technoline documented skip key and hangup callback are handled explicitly',async()=>{
 const first=await worker.fetch(new Request('https://example.workers.dev/?'+call),{}).json();
 assert.equal(first.skipKey,'#');assert.equal(first.confirmType,'number');
 const p=new URLSearchParams(call);p.set('PBXcallStatus','HANGUP');
 p.set('mr_callback','NO');
 assert.deepEqual(await worker.fetch(new Request('https://example.workers.dev/?'+p),{}).json(),{type:'hangup'});
});
