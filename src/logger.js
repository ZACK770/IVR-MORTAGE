export function logEvent(event, id = '', details = {}) {
  const entry = { time: new Date().toISOString(), event };
  if (/^[A-Za-z0-9_-]{16,100}$/.test(id)) entry.id = id;
  for (const key of ['stage', 'code', 'attempt', 'status', 'durationMs']) {
    if (Object.hasOwn(details, key)) entry[key] = details[key];
  }
  console.log(JSON.stringify(entry));
}
