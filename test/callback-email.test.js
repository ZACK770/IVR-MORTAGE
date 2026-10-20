import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import {handleCall} from '../src/flow.js';
import {submissionFrom} from '../src/submissions.js';
import {emailContent,deliverEmail,shouldEmail} from '../src/email.js';

const base={PBXcallId:'test-12345678901234567',mr_submission_id:'test-12345678901234567',PBXcallStatus:'CALL',PBXphone:'0500000000',mr_elapsed:'5',mr_term:'25',mr_amount:'100000'};
test('offer is short, 1 transfers to extension 2, other choices end the call',()=>{
 const offer=handleCall(base);
 assert.equal(offer.name,'mr_callback');
 assert.equal(offer.type,'simpleMenu');
 assert.equal(offer.enabledKeys,'1');
 assert.ok(offer.files.map(f=>f.text||'').join(' ').length<130);
 assert.deepEqual(handleCall({...base,mr_callback:'1'}),{type:'goTo',extensionPathChange:'/2',addParams:{mr_stage:'callback_requested'}});
 assert.deepEqual(handleCall({...base,mr_callback:'2'}),{type:'hangup'});
 assert.deepEqual(handleCall({...base,mr_callback:'NO'}),{type:'hangup'});
 assert.equal(submissionFrom({...base,mr_callback:'1'}).status,'ביקש לחזור אליו');
});
test('hangup at every question preserves only valid answers and no invented estimate',()=>{
 for(const [answers,stage,count] of [[{},'mr_elapsed',0],[{mr_elapsed:'0'},'mr_term',1],[{mr_elapsed:'5',mr_term:'25'},'mr_amount',2]]) {
  const lead=submissionFrom({mr_submission_id:base.mr_submission_id,PBXcallStatus:'HANGUP',...answers});
  assert.equal(lead.status,'נותק באמצע');assert.equal(lead.stage,stage);
  assert.equal([lead.elapsed,lead.term,lead.amount].filter(v=>v!==null).length,count);
  assert.equal(lead.savings,null);
 }
 assert.equal(submissionFrom({...base,mr_term:'2',PBXcallStatus:'HANGUP'}).term,null);
 assert.equal(submissionFrom({...base,PBXcallStatus:'HANGUP'}).status,'השלים פרטים');
});
test('Worker sends email on partial HANGUP and callback request without blocking voice',async()=>{
 for(const extra of [{mr_callback:'1'},{PBXcallStatus:'HANGUP',mr_amount:''}]) {
  const sent=[],pending=[];
  const env={EMAIL_FROM:'ivr@example.com',EMAIL_TO:'owner@example.com',EMAIL:{send:async message=>{sent.push(message);return {messageId:'test'};}}};
  const p={...base,...extra};const response=worker.fetch(new Request('https://example.workers.dev/?'+new URLSearchParams(p)),env,{waitUntil:p=>pending.push(p)});
  assert.equal(response.status,200);await Promise.all(pending);
  assert.equal(sent.length,1);assert.equal(sent[0].to,'owner@example.com');
  assert.match(sent[0].text,/0500000000/);
  assert.equal(shouldEmail({...p,mr_stage:'callback_requested'}, {type:'hangup'}),false);
 }
 assert.equal(shouldEmail(base,handleCall(base)),false);
});
test('email escapes external text and logs safe service errors, not personal data',async()=>{
 const lead=submissionFrom({...base,mr_callback:'1'});lead.caller='<script>bad</script>';
 assert.ok(!emailContent(lead).html.includes('<script>'));
 const logs=[],old=console.log;console.log=s=>logs.push(s);
 try {
  assert.equal(await deliverEmail(lead,{EMAIL:{send:async()=>{throw Object.assign(new Error('private payload'),{code:'E_RECIPIENT_NOT_ALLOWED'});}},EMAIL_FROM:'ivr@example.com',EMAIL_TO:'owner@example.com'}),false);
  assert.ok(logs.some(s=>s.includes('E_RECIPIENT_NOT_ALLOWED')));
  assert.ok(!logs.join('').includes('private payload'));
  assert.ok(!logs.join('').includes('<script>'));
 } finally {console.log=old;}
});
