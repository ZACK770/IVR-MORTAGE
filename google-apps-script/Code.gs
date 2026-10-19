// Paste this file in Extensions > Apps Script inside the results spreadsheet.
// Project Settings > Script properties: set SHEETS_SHARED_SECRET (24+ random characters).
const SPREADSHEET_ID = '1Ckb7dGI_jmOmpdYzB-g-qzysM7TO1xPYER15L_wgEx0';
const SHEET_NAME = 'פניות';
const HEADERS = ["מזהה פנייה","תאריך ושעה","טלפון המתקשר","שלוחה","לפני כמה שנים נלקחה","תקופת המשכנתא המקורית","סכום המשכנתא המקורי","שנים שנותרו","אומדן חיסכון","הערות"];

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
  if (!Number.isInteger(lead.elapsed) || lead.elapsed < 0 || lead.elapsed > 40 ||
      !Number.isInteger(lead.term) || lead.term < 1 || lead.term > 40 || lead.term < lead.elapsed ||
      !Number.isInteger(lead.amount) || lead.amount < 1 || lead.amount > 99999999) return false;
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
    const currentHeaders = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
    if (JSON.stringify(currentHeaders) !== JSON.stringify(HEADERS)) return reply_({ ok: false, code: 'HEADER_MISMATCH' });
    if (last > 1 && sheet.getRange(2, 1, last - 1, 1).createTextFinder(lead.id).matchEntireCell(true).findNext()) {
      return reply_({ ok: true, id: lead.id, duplicate: true });
    }
    const row = last + 1;
    if (row > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 100);
    const remaining = lead.term - lead.elapsed;
    const savings = Math.round(lead.amount * remaining / 50);
    sheet.getRange(row, 3, 1, 2).setNumberFormat('@');
    sheet.getRange(row, 1, 1, HEADERS.length).setValues([[
      lead.id, new Date(lead.receivedAt), plain_(lead.caller, 40), plain_(lead.extension, 100),
      lead.elapsed, lead.term, lead.amount, remaining, savings,
      'אומדן בלבד לפי המודל שנקבע; אינו חישוב חיסכון אישי.'
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
