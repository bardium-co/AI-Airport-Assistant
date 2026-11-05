// Rules engine for lounge-access *provisional* eligibility.
// It NEVER grants access: results are always "unverified" until a staff member checks documents
// and records an approval (see staff cases). Rules are admin-configurable data, seeded as SIMULATED.

export const CABINS = ['economy', 'premium_economy', 'business', 'first'];
export const CARRIERS = ['QR', 'ONEWORLD', 'OTHER'];
export const TIERS = ['NONE', 'PC_BURGUNDY', 'PC_SILVER', 'PC_GOLD', 'PC_PLATINUM', 'OW_RUBY', 'OW_SAPPHIRE', 'OW_EMERALD', 'OTHER'];

const TIER_ALLIANCE = { OW_RUBY: 'OW_RUBY', OW_SAPPHIRE: 'OW_SAPPHIRE', OW_EMERALD: 'OW_EMERALD', PC_SILVER: 'OW_RUBY', PC_GOLD: 'OW_SAPPHIRE', PC_PLATINUM: 'OW_EMERALD' };

export function validateProfile(p = {}) {
  return {
    carrier: CARRIERS.includes(p.carrier) ? p.carrier : null,
    cabin: CABINS.includes(p.cabin) ? p.cabin : null,
    tier: TIERS.includes(p.tier) ? p.tier : 'NONE',
  };
}

function ruleMatches(rule, prof) {
  if (rule.carriers && !rule.carriers.includes('ANY')) {
    const ok = rule.carriers.includes(prof.carrier) || (rule.carriers.includes('ONEWORLD') && prof.carrier === 'QR');
    if (!ok) return false;
  }
  if (rule.cabins && !rule.cabins.includes(prof.cabin)) return false;
  if (rule.tiers) {
    const equivalents = [prof.tier, TIER_ALLIANCE[prof.tier]].filter(Boolean);
    if (!rule.tiers.some(t => equivalents.includes(t))) return false;
  }
  return true;
}

export function isOpenNow(hours, now = Date.now(), tz = 'Asia/Qatar') {
  if (!hours) return null;
  if (hours.always) return true;
  if (!hours.open || !hours.close) return null;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now));
  const h = Number(parts.find(p => p.type === 'hour').value);
  const m = Number(parts.find(p => p.type === 'minute').value);
  const cur = h * 60 + m;
  const [oh, om] = hours.open.split(':').map(Number);
  const [ch, cm] = hours.close.split(':').map(Number);
  const o = oh * 60 + om, c = ch * 60 + cm;
  return o <= c ? (cur >= o && cur < c) : (cur >= o || cur < c);
}

/**
 * @returns {{result:'likely'|'paid_option'|'unlikely'|'unknown'|'closed', verified:false, reasons:string[]}}
 */
export function evaluateLounge(lounge, profileIn) {
  const prof = validateProfile(profileIn);
  const rules = lounge.rules ?? {};
  const base = { verified: false, requiresVerification: true, reasons: [] };
  if (lounge.status === 'closed') return { ...base, result: 'closed', reasons: ['lounge_closed'] };
  if (!prof.carrier || !prof.cabin) return { ...base, result: 'unknown', reasons: ['need_ticket_details'] };
  const matched = (rules.rules ?? []).find(r => ruleMatches(r, prof));
  if (matched) return { ...base, result: 'likely', reasons: [matched.reason ?? 'rule_match'], rule: matched };
  if (rules.paid) return { ...base, result: 'paid_option', reasons: ['paid_access_may_be_available'] };
  return { ...base, result: 'unlikely', reasons: ['no_rule_match'] };
}

const ORDER = { likely: 0, paid_option: 1, unknown: 2, unlikely: 3, closed: 4 };

export function rankLounges(lounges, profile, distances, speed) {
  return lounges.map(l => {
    const ev = evaluateLounge(l, profile);
    const d = distances.get(l.location_id);
    return {
      ...l, eligibility: ev,
      meters: d == null ? null : Math.round(d),
      minutes: d == null ? null : Math.max(1, Math.ceil(d / speed)),
    };
  }).sort((a, b) => (ORDER[a.eligibility.result] - ORDER[b.eligibility.result]) || ((a.meters ?? 1e9) - (b.meters ?? 1e9)));
}
