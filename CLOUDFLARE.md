# פריסה בחינם ב־Cloudflare Workers

מיועד לטופס Module API הקטן בפרויקט הזה. המרכזייה משמיעה ומקבלת הקשות;
ה־Worker מחזיר JSON ומחשב אומדן בלבד. אין צורך בשרת שעובד ברקע, מסד נתונים או שירות בתשלום.

## דרך הדפדפן — קובץ אחד

1. פותחים חשבון Cloudflare ובוחרים Workers & Pages.
2. יוצרים Worker במסלול Workers Free.
3. פותחים את עורך הקוד ומדביקים את כל dist/worker.js במקום הקוד הראשוני.
4. השיחה פועלת ללא סודות או משתני סביבה. לשמירת פניות מגדירים את החיבור לפי GOOGLE-SHEETS.md.
5. פורסים את הגרסה.
6. בודקים שהנתיב /healthz מחזיר {"status":"ok"}.
7. מגדירים בטכנוליין את הכתובת הבאה, עם ערכי החשבון האמיתיים:
   https://ivr-mortage.<your-subdomain>.workers.dev/
8. מגדירים paramsMode=chain בשלוחה ומבצעים שיחת ניסיון.

אין צורך לקנות דומיין. כתובת workers.dev נוצרת בחשבון.
אין להפעיל Cloudflare Access או מסך התחברות על כתובת הטופס: המרכזייה צריכה להגיע אליה ב־GET.

## דרך GitHub או CLI

wrangler.json מכוון ל־src/worker.js. בהגדרת חיבור Git ב־Cloudflare משתמשים
בפקודת פריסה npx wrangler deploy, ומוסיפים את הסוד בסביבת ה־Worker.

אפשר גם להריץ עם חשבון Cloudflare מחובר:

```sh
npx wrangler login
npx wrangler deploy
```

## בדיקות

```sh
node --test test/worker.test.js
npm run build:worker
```

הבדיקות מפעילות את ה־Worker עם Request ו־Response תקניים, ללא חיבור רשת.
הן אינן תחליף לבדיקת שיחה אמיתית או לבדיקת סביבת Cloudflare לאחר פריסה.

## מכסה

לפי התיעוד הרשמי שנבדק ב־19 באוקטובר 2026, Workers Free כולל
100,000 בקשות ביום ועד 10 מילישניות CPU לבקשה.
בזרימה הזו יש בדרך כלל חמש בקשות לשיחה מלאה (פתיחה, שתי שאלות נוספות, תוצאה וניתוק).
לכן 100,000 בקשות הן עד כ־20,000 שיחות רגילות, לפני שגיאות, בדיקות ותעבורה אחרת בחשבון.
המכסה היא ברמת החשבון. אין הבטחת זמינות מוחלטת או SLA במסלול חינמי.

https://developers.cloudflare.com/workers/platform/pricing/
https://developers.cloudflare.com/workers/reference/how-workers-works/

## שמירת פניות

הגרסה כוללת שליחה לגוגל שיטס. חובה להשלים את [GOOGLE-SHEETS.md](GOOGLE-SHEETS.md) לפני שימוש בקליטת פניות.

גרסה 1.2.0: ברירת המחדל היא /. נקלטים PBXcallId, PBXphone, PBXextensionPath.
IVR_PATH_SECRET הוא אופציונלי; רק אם מגדירים אותו משתמשים בנתיב /ivr/<secret>.
