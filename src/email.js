import { logEvent } from './logger.js';

export function shouldEmail(params, module) {
  // Send at the choice/exit, not while the savings offer is still playing.
  // A subsequent HANGUP after goTo must not generate another notification.
  if (params.mr_stage === 'callback_requested') return false;
  return module.type === 'goTo' || params.PBXcallStatus === 'HANGUP';
}

export function emailContent(lead) {
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

export async function deliverEmail(lead, env) {
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
