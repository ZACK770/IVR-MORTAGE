const FIELDS = ['mr_elapsed', 'mr_term', 'mr_amount'];
const MAX_FAILURES = 3;
const text = (value) => ({ text: value });
const own = (p, key) => Object.hasOwn(p, key);

export function integer(raw, min, max) {
  if (typeof raw !== 'string' || !/^[0-9]+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : null;
}

export function estimate({ elapsed, term, amount }) {
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
    min: 1, max: index === 2 ? 8 : 2, timeout: 10
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
export function handleCall(params) {
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

  const { remaining, savings } = estimate({ elapsed, term, amount });
  const files = remaining === 0
    ? [text('לפי הנתונים שמסרתם, תקופת המשכנתא הסתיימה, ולכן אומדן החיסכון במחשבון הוא אפס שקלים. תודה ולהתראות.')]
    : [
      text('לפי הנתונים שמסרתם, מספר השנים שנותרו לתשלום הוא'),
      { number: remaining },
      text('ואומדן החיסכון ממיחזור המשכנתא הוא'),
      { number: savings },
      text('שקלים. זהו אומדן בלבד, לפי מודל קבוע המבוסס על הסכום המקורי והשנים שנותרו. החיסכון בפועל מצריך בדיקה אישית של יתרת ההלוואה, הריביות והעלויות. תודה ולהתראות.')
    ];
  return { type: 'simpleMessage', files, addParams: { mr_stage: 'done' } };
}
