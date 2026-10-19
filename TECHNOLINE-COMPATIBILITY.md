# בדיקת תאימות — 19.10.2026

נבדק גם התיעוד המפורט המקורי:
https://pbx.tlivr.com/apiModuleDocs.html

- פרמטרי GET: PBXphone, PBXnum, PBXdid, PBXcallId, PBXcallStatus, PBXextensionId, PBXextensionPath.
- PBXcallStatus=HANGUP מטופל בנפרד ואינו מתחיל טופס חדש.
- getDTMF כולל type, name, max; וכן min, timeout, skipKey=#, skipValue=ERROR, confirmType=number.
- התשובה נקראת בשם שהוגדר ב־name, למשל mr_elapsed=5.
- simpleMessage עם מערך files; מקטעי text ומספרים כ־number מסוג מחרוזת, כפי שמופיע בדוגמאות.
- addParams משמר מזהה ותאריך בין callbacks; removeParams מנקה תשובות שגויות ותשובות המשך.
- החזרה היא JSON תקין, application/json; charset=utf-8.
- הכתובת הראשית / עובדת ללא apiKey, Authorization או סוד, בהתאם ל־Module API.
- אין תלות ב־Interaction API, בסטרימינג או ב־AI.
- בדיקות משתמשות באותו מבנה פרמטרים של בקשת הייצור, עם פרטים מזהים מדומים.

נוספה בדיקת קידוד נגד תו ההחלפה U+FFFD.
נוספו בדיקות לשמירת פניות, מניעת כפילויות, ניסיונות חוזרים ולוג ללא נתוני המשכנתא.

## מגבלות האימות

השיחה החיה אינה מאומתת מהסביבה הזו.
בקשת HTTP לכתובת ה־Worker נענתה בחסימת NetFree מהסביבה המקומית (418), ולכן אין להסיק ממנה על זמינות השירות למרכזיית טכנוליין.
בדיקות היחידה ובקשות Request/Response אינן מדמות את מנוע הטלפוניה, ההשמעה או שירותי Google האמיתיים.
יש לפרוס את הקוד ולבדוק שיחה חיה אחת, כולל הופעת שורה בשיטס לאחר השלמת החיבור.
