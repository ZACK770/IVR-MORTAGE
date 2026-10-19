# לוגים ואבחון

ב־Cloudflare: Workers & Pages > ivr-mortage > Logs > Live.
לצפייה בהיסטוריה מפעילים Workers Logs בהגדרות Observability.
wrangler.json מפעיל שמירת לוגים ב־100% דגימה, בכפוף למכסת Cloudflare.
בהדבקה ידנית של קוד, wrangler.json אינו מופעל: יש להפעיל את ההגדרות בלוח הניהול.

לכל פנייה נוצר id אקראי, שנשלח בכל callback דרך addParams ונרשם גם בעמודה הראשונה בשיטס.
אפשר לחפש את ה־id בלוגים כדי לעקוב אחרי אותה שיחה.
אין לוג של טלפון, סכומים, תשובות, סודות או כתובת הבקשה בקוד שלנו.

| אירוע / קוד | משמעות |
|---|---|
| module_returned / mr_elapsed | הוחזרה השאלה הראשונה |
| module_returned / mr_term | הוחזרה השאלה השנייה |
| module_returned / mr_amount | הוחזרה שאלת הסכום |
| module_returned / result | הוחזרה הוראת השמעת התוצאה או הודעת סיום עקב שגיאות |
| module_returned / hangup | הוחזרה הוראת ניתוק |
| INVALID_INPUT | תשובה לא תקינה והנחיה להקיש שוב |
| IVR_SECRET_MISSING | לא הוגדר סוד תקין ב־Cloudflare |
| PATH_MISMATCH | הפנייה הגיעה לנתיב שגוי |
| DUPLICATE_PARAMETER | פרמטר הופיע פעמיים |
| sheets_skipped / NOT_CONFIGURED | טרם הוגדר webhook לשיטס |
| sheets_attempt | ניסיון שליחה, עם מספר ניסיון |
| sheets_saved | Google אישר שהשורה נשמרה או כבר הייתה קיימת |
| AUTH_FAILED | הסוד ב־Google אינו זהה לסוד ב־Cloudflare |
| CONFIG_MISSING | לא הוגדר סוד תקין ב־Google |
| INVALID_CONFIG | כתובת webhook או סוד אינם תקינים ב־Cloudflare |
| MISSING_SHEET | לשונית פניות חסרה |
| HEADER_MISMATCH | כותרות העמודות שונו |
| NON_JSON_RESPONSE | התקבל דף HTML או תשובה שאינה JSON; לבדוק פריסה והרשאות גישה |
| HTTP_ERROR | שגיאת HTTP מגוגל, בצירוף הסטטוס |
| TIMEOUT / NETWORK_ERROR | חריגת זמן או תקלה בתקשורת |
| RETRIES_EXHAUSTED | כל שלושת ניסיונות המשלוח נכשלו |
| WRITE_FAILED | תקלה בעת נעילה או כתיבה ל־Google |
| INTERNAL_ERROR | שגיאה פנימית ב־Worker |

ב־Apps Script > Executions רואים את הרצות הסקריפט, שמירת שורה או כשל כתיבה.
ה־Worker גם מקבל מגוגל קוד סיבה, לכן רוב האבחון נמצא במקום אחד.

## פרטיות בלוגי התשתית

לוגי הפעלה אוטומטיים של Cloudflare עלולים לכלול את URL הבקשה ופרמטריה.
wrangler.json מכבה invocation_logs. בהגדרה ידנית יש לכבות גם אותם
או להשתמש בפריסה באמצעות Wrangler כדי להחיל את ההגדרה.
הדבר אינו משנה את אופן הפעולה של Live logs או את לוגי הגישה של ספקים אחרים.

## מה הלוג אינו מוכיח

module_returned מוכיח שהשרת החזיר הוראה; הוא אינו מוכיח שהמתקשר שמע אותה.
אם טכנוליין אינה פונה לכתובת שלנו, לא יהיה אירוע שיחה בלוגר שלנו.
במקרה כזה בודקים את הגדרת השלוחה ואת לוג השיחה בטכנוליין.
המערכת נחשבת מאומתת רק אחרי שיחה חיה שבה השאלות נשמעות, התוצאה נכונה ונוספת שורה אחת בגיליון.
