// Privacy-protective analytics: only daily aggregate counts of (mode, intent, language).
// No message text, no IP addresses, no user identifiers, no device fingerprints are ever stored.
// Reports suppress small cells (below the configured minimum count) to prevent re-identification.

const INTENT_RE = /^[a-z_]{1,40}$/;

export function qatarDay(ts = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Qatar', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts));
}

export class Analytics {
  constructor(db) { this.db = db; }

  record(mode, intent, lang) {
    if (!this.db.getSetting('analytics_enabled', true)) return;
    const i = INTENT_RE.test(intent) ? intent : 'other';
    const l = /^[a-z]{2,3}(-[A-Z]{2})?$/.test(lang) ? lang : 'other';
    const m = ['passenger', 'staff', 'kiosk'].includes(mode) ? mode : 'other';
    this.db.run(`INSERT INTO analytics_daily(day,mode,intent,lang,count) VALUES(?,?,?,?,1)
      ON CONFLICT(day,mode,intent,lang) DO UPDATE SET count = count + 1`, qatarDay(), m, i, l);
  }

  report(days = 30) {
    const k = Number(this.db.getSetting('analytics_min_count', 5));
    const since = qatarDay(Date.now() - (days - 1) * 86400000);
    const rows = this.db.all('SELECT * FROM analytics_daily WHERE day >= ?', since);
    const group = key => {
      const m = new Map();
      for (const r of rows) m.set(r[key], (m.get(r[key]) ?? 0) + r.count);
      return [...m.entries()].map(([name, count]) => count < k ? { name, count: null, suppressed: true } : { name, count, suppressed: false })
        .sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
    };
    const total = rows.reduce((s, r) => s + r.count, 0);
    const byDay = new Map();
    for (const r of rows) byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.count);
    const daily = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = qatarDay(Date.now() - i * 86400000);
      const c = byDay.get(d) ?? 0;
      daily.push({ day: d, count: c > 0 && c < k ? null : c, suppressed: c > 0 && c < k });
    }
    return {
      days, minCount: k, total: total < k ? null : total, totalSuppressed: total > 0 && total < k,
      byIntent: group('intent'), byLang: group('lang'), byMode: group('mode'), daily,
    };
  }

  purge() {
    const keep = Number(this.db.getSetting('analytics_retention_days', 400));
    this.db.run('DELETE FROM analytics_daily WHERE day < ?', qatarDay(Date.now() - keep * 86400000));
  }
}
