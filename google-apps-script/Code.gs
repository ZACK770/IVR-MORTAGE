// Paste this file in Extensions > Apps Script inside the results spreadsheet.
// Project Settings > Script properties: set SHEETS_SHARED_SECRET (24+ random characters).
const SPREADSHEET_ID = '1Ckb7dGI_jmOmpdYzB-g-qzysM7TO1xPYER15L_wgEx0';
const SHEET_NAME = 'פניות';
const HEADERS = ["מזהה פנייה","תאריך ושעה","טלפון המתקשר","שלוחה","לפני כמה שנים נלקחה","תקופת המשכנתא המקורית","סכום המשכנתא המקורי","שנים שנותרו","אומדן חיסכון","הערות","סטטוס","שלב אחרון","דירוג סטטוס"];

function reply_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function plain_(value, max) {
  // Prevent spreadsheet formulas in externally supplied text.
  const text = String(value || '').slice(0, max);
  return /^[=+@\-\t\r\n]/.test(text) ? "'" + text : text;
}

function validLead_(lead) {
  if (!lead || typeof lead.id !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(lead.id)) return false;
  const nullableInt = (v, min, max) => v === null || (Number.isInteger(v) && v >= min && v <= max);
  if (!nullableInt(lead.elapsed, 0, 40) || !nullableInt(lead.term, 1, 40) ||
      !nullableInt(lead.amount, 1, 99999999)) return false;
  if ((lead.elapsed === null && lead.term !== null) ||
      (lead.term === null && lead.amount !== null) ||
      (lead.term !== null && lead.term < lead.elapsed)) return false;
  const complete = lead.elapsed !== null && lead.term !== null && lead.amount !== null;
  const statuses = {1: 'נותק באמצע', 2: 'השלים פרטים', 3: 'ביקש לחזור אליו'};
  if (lead.status !== statuses[lead.statusRank] || !statuses[lead.statusRank] ||
      (complete ? lead.statusRank < 2 : lead.statusRank !== 1)) return false;
  return typeof lead.receivedAt === 'string' && !isNaN(new Date(lead.receivedAt).getTime());
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    if (!e || !e.postData || e.postData.contents.length > 12000) return reply_({ ok: false, code: 'INVALID_PAYLOAD' });
    const body = JSON.parse(e.postData.contents);
    const expected = PropertiesService.getScriptProperties().getProperty('SHEETS_SHARED_SECRET');
    if (!expected || expected.length < 24) return reply_({ ok: false, code: 'CONFIG_MISSING' });
    if (body.secret !== expected) return reply_({ ok: false, code: 'AUTH_FAILED' });
    const lead = body.lead;
    if (!validLead_(lead)) return reply_({ ok: false, code: 'INVALID_PAYLOAD' });
    lock.waitLock(10000);
    const book = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = book.getSheetByName(SHEET_NAME);
    if (!sheet) return reply_({ ok: false, code: 'MISSING_SHEET' });
    const last = sheet.getLastRow();
    let currentHeaders = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
    if (JSON.stringify(currentHeaders.slice(0,10)) === JSON.stringify(HEADERS.slice(0,10)) &&
        currentHeaders.slice(10).every(v => !v)) {
      sheet.getRange(1, 11, 1, 3).setValues([HEADERS.slice(10)]);
      currentHeaders = HEADERS;
    }
    if (JSON.stringify(currentHeaders) !== JSON.stringify(HEADERS)) return reply_({ ok: false, code: 'HEADER_MISMATCH' });
    const found = last > 1 ? sheet.getRange(2, 1, last - 1, 1).createTextFinder(lead.id).matchEntireCell(true).findNext() : null;
    const row = found ? found.getRow() : last + 1;
    if (found) {
      const existing = sheet.getRange(row, 1, 1, HEADERS.length).getValues()[0];
      // Legacy completed rows have no explicit rank. Never downgrade callback requests.
      const rank = Number(existing[12]) || (existing[6] !== '' ? 2 : 1);
      const oldCount = existing.slice(4,7).filter(v => v !== '' && v !== null).length;
      const newCount = [lead.elapsed,lead.term,lead.amount].filter(v => v !== null).length;
      if (rank > lead.statusRank || (rank === lead.statusRank && oldCount >= newCount)) {
        return reply_({ ok: true, id: lead.id, duplicate: true });
      }
    }
    if (row > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 100);
    const complete = lead.elapsed !== null && lead.term !== null && lead.amount !== null;
    const remaining = complete ? lead.term - lead.elapsed : '';
    const savings = complete ? Math.round(lead.amount * remaining / 50) : '';
    sheet.getRange(row, 3, 1, 2).setNumberFormat('@');
    sheet.getRange(row, 1, 1, HEADERS.length).setValues([[
      lead.id, new Date(lead.receivedAt), plain_(lead.caller, 40), plain_(lead.extension, 100),
      lead.elapsed ?? '', lead.term ?? '', lead.amount ?? '', remaining, savings,
      complete ? 'אומדן בלבד לפי המודל שנקבע.' : 'הנתונים חלקיים.',
      lead.status, plain_(lead.stage, 40), lead.statusRank
    ]]);
    sheet.getRange(row, 2).setNumberFormat('dd/MM/yyyy HH:mm:ss');
    sheet.getRange(row, 7).setNumberFormat('"₪" #,##0');
    sheet.getRange(row, 9).setNumberFormat('"₪" #,##0');
    const filter = sheet.getFilter();
    if (filter && row > filter.getRange().getLastRow()) {
      filter.remove();
      sheet.getRange(1, 1, sheet.getMaxRows(), HEADERS.length).createFilter();
    }
    SpreadsheetApp.flush();
    console.log(JSON.stringify({ event: 'sheet_row_saved', id: lead.id, row: row }));
    return reply_({ ok: true, id: lead.id, duplicate: false });
  } catch (_) {
    console.error(JSON.stringify({ event: 'sheet_write_failed', code: 'WRITE_FAILED' }));
    return reply_({ ok: false, code: 'WRITE_FAILED' });
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}
