import crypto from 'node:crypto';
import { HttpError } from '../http.js';
import { str, oneOf, arr, obj, bool } from '../validate.js';
import { PHRASEBOOK } from '../services/translate.js';
import { evaluateLounge, CABINS, CARRIERS, TIERS } from '../services/eligibility.js';
import { loungeView } from '../services/assistant.js';
import { normalizeFlightNo } from '../services/flights.js';
import { hasRole } from '../auth.js';
import { parseJson } from '../db.js';
import { joinUrl } from '../services/integrations.js';

const LANG_RE = /^[a-z]{2,3}(-[A-Z]{2})?$/;

export const CHECKLISTS = {
  lounge: [
    { key: 'boarding_pass', label: 'Boarding pass sighted — departs DOH today, name matches', required: true },
    { key: 'carrier_cabin', label: 'Operating carrier and cabin class confirmed on boarding pass', required: true },
    { key: 'identity', label: 'Passenger identity matches the boarding pass', required: true },
    { key: 'membership', label: 'Membership card/app sighted — tier and expiry valid (required when access is status-based)', required: false },
  ],
  upgrade: [
    { key: 'boarding_pass', label: 'Boarding pass / booking sighted', required: true },
    { key: 'fare_rules', label: 'Fare conditions permit an upgrade (checked in airline system)', required: true },
    { key: 'availability', label: 'Seat availability confirmed in airline system', required: true },
    { key: 'payment_method', label: 'Method agreed (Avios / Qcredits / paid) — balance shown in passenger’s own app', required: true },
    { key: 'passenger_informed', label: 'Passenger told the upgrade is not confirmed until the airline system confirms it', required: true },
  ],
  membership: [
    { key: 'membership', label: 'Membership card/app sighted', required: true },
    { key: 'identity', label: 'Passenger identity confirmed', required: true },
    { key: 'referred', label: 'Account-specific questions referred to the airline loyalty desk/app', required: true },
  ],
};

function refCode() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(8);
  let s = '';
  for (let i = 0; i < 8; i++) s += alphabet[bytes[i] % alphabet.length];
  return `BV-${s.slice(0, 4)}-${s.slice(4)}`;
}

export function caseView(db, c) {
  const users = id => (id ? db.get('SELECT display_name, username FROM users WHERE id = ?', id) : null);
  const inputs = parseJson(c.inputs, {});
  return {
    id: c.id, kind: c.kind, inputs, provisional: parseJson(c.provisional, {}), checklist: parseJson(c.checklist, {}),
    checklistDef: effectiveChecklist(c.kind, parseJson(c.provisional, {})), status: c.status, requiresRole: c.requires_role,
    createdAt: c.created_at, createdBy: users(c.created_by)?.display_name, createdById: c.created_by,
    decidedAt: c.decided_at, decidedBy: users(c.decided_by)?.display_name, decisionReason: c.decision_reason,
    recommendedBy: users(c.recommended_by)?.display_name,
    refCode: c.status === 'approved' ? c.ref_code : null, refExpires: c.ref_expires,
    loungeName: inputs.loungeId ? db.get('SELECT name FROM lounges WHERE id = ?', inputs.loungeId)?.name : null,
  };
}

function effectiveChecklist(kind, provisional) {
  return CHECKLISTS[kind].map(i => (i.key === 'membership' && kind === 'lounge' && provisional?.rule?.tiers ? { ...i, required: true } : i));
}

export function registerStaff(router, d) {
  const { db, translator, integrations, analytics } = d;
  const staff = { auth: 'staff' };

  router.get('/api/staff/phrases', () => ({ phrases: PHRASEBOOK }), staff);

  router.get('/api/staff/config', () => ({
    storeTranscripts: !!db.getSetting('store_transcripts', false), retentionDays: db.getSetting('transcript_retention_days', 7),
    translation: translator.status(), loyalty: integrations.publicSummary().loyalty, checklists: CHECKLISTS,
  }), staff);

  router.post('/api/staff/translate', async ({ body }) => {
    const text = str(body.text, 'text', { required: true, max: 1000 });
    const from = str(body.from, 'from', { required: true, pattern: LANG_RE });
    const to = str(body.to, 'to', { required: true, pattern: LANG_RE });
    const r = await translator.translate(text, from, to);
    analytics.record('staff', 'translate', to);
    return { original: text, from, to, ...r };
  }, { ...staff, rate: 'translate' });

  router.get('/api/staff/guidance', ({ query, user }) => {
    const includeDrafts = hasRole(user, 'supervisor') && query.get('drafts') === '1';
    const rows = db.all(`SELECT * FROM guidance WHERE status = 'approved' ${includeDrafts ? "OR status = 'draft'" : ''} ORDER BY topic, id`);
    return { items: rows.map(g => ({ ...g, passenger_text: parseJson(g.passenger_text, {}) })) };
  }, staff);

  router.post('/api/staff/guidance/:id/approve', ({ params, user }) => {
    const g = db.get('SELECT * FROM guidance WHERE id = ?', Number(params.id));
    if (!g) throw new HttpError(404, 'Guidance not found');
    if (g.status === 'approved') throw new HttpError(409, 'Already approved');
    db.run(`UPDATE guidance SET status='approved', approved_by=?, approved_at=? WHERE id=?`, `${user.displayName} (${user.role})`, Date.now(), g.id);
    db.audit(user, 'guidance.approve', `guidance:${g.id}`, { version: g.version });
    return { ok: true };
  }, { auth: 'supervisor' });

  // ---- Eligibility cases ----
  router.get('/api/staff/cases', ({ query }) => {
    const status = oneOf(query.get('status'), 'status', ['pending', 'approved', 'denied', 'escalated', 'open']);
    let rows;
    if (status === 'open') rows = db.all(`SELECT * FROM eligibility_cases WHERE status IN ('pending','escalated') ORDER BY created_at DESC LIMIT 200`);
    else if (status) rows = db.all('SELECT * FROM eligibility_cases WHERE status = ? ORDER BY created_at DESC LIMIT 200', status);
    else rows = db.all('SELECT * FROM eligibility_cases ORDER BY created_at DESC LIMIT 200');
    return { items: rows.map(c => caseView(db, c)) };
  }, staff);

  router.get('/api/staff/cases/:id', ({ params }) => {
    const c = db.get('SELECT * FROM eligibility_cases WHERE id = ?', Number(params.id));
    if (!c) throw new HttpError(404, 'Case not found');
    return caseView(db, c);
  }, staff);

  router.post('/api/staff/cases', ({ body, user }) => {
    const kind = oneOf(body.kind, 'kind', ['lounge', 'upgrade', 'membership'], { required: true });
    const i = obj(body.inputs, 'inputs');
    const last4 = str(i.memberLast4, 'memberLast4', { pattern: /^\d{4}$/ });
    const flightRaw = str(i.flightNo, 'flightNo', { max: 10 });
    const flightNo = flightRaw ? normalizeFlightNo(flightRaw) : null;
    if (flightRaw && !flightNo) throw new HttpError(400, 'flightNo has an invalid format');
    let inputs, provisional, requiresRole = 'staff';
    if (kind === 'lounge') {
      const loungeId = str(i.loungeId, 'loungeId', { required: true, max: 40 });
      const lounge = db.get('SELECT * FROM lounges WHERE id = ?', loungeId);
      if (!lounge) throw new HttpError(400, 'Unknown lounge');
      inputs = { flightNo, loungeId, carrier: oneOf(i.carrier, 'carrier', CARRIERS, { required: true }), cabin: oneOf(i.cabin, 'cabin', CABINS, { required: true }), tier: oneOf(i.tier, 'tier', TIERS, { fallback: 'NONE' }), memberLast4: last4 };
      provisional = evaluateLounge(loungeView(lounge), inputs);
    } else if (kind === 'upgrade') {
      inputs = { flightNo, fromCabin: oneOf(i.fromCabin, 'fromCabin', CABINS, { required: true }), toCabin: oneOf(i.toCabin, 'toCabin', CABINS, { required: true }), method: oneOf(i.method, 'method', ['avios', 'qcredits', 'paid'], { required: true }), tier: oneOf(i.tier, 'tier', TIERS, { fallback: 'NONE' }), memberLast4: last4 };
      if (CABINS.indexOf(inputs.toCabin) <= CABINS.indexOf(inputs.fromCabin)) throw new HttpError(400, 'Upgrade must be to a higher cabin');
      provisional = { result: 'requires_airline_system', verified: false, reasons: ['airline_reservation_system_not_connected', 'supervisor_approval_required'] };
      requiresRole = 'supervisor';
    } else {
      inputs = { tier: oneOf(i.tier, 'tier', TIERS, { fallback: 'NONE' }), topic: oneOf(i.topic, 'topic', ['tier', 'qcredits', 'avios', 'other'], { required: true }), memberLast4: last4 };
      provisional = { result: 'information_only', verified: false, reasons: ['account_specific_questions_referred'] };
    }
    const r = db.run('INSERT INTO eligibility_cases(kind,inputs,provisional,checklist,status,requires_role,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)',
      kind, JSON.stringify(inputs), JSON.stringify(provisional), '{}', 'pending', requiresRole, user.id, Date.now());
    db.audit(user, 'case.create', `case:${r.lastInsertRowid}`, { kind });
    analytics.record('staff', `case_${kind}`, 'xx');
    return caseView(db, db.get('SELECT * FROM eligibility_cases WHERE id = ?', Number(r.lastInsertRowid)));
  }, staff);

  router.post('/api/staff/cases/:id/checklist', ({ params, body, user }) => {
    const c = db.get('SELECT * FROM eligibility_cases WHERE id = ?', Number(params.id));
    if (!c) throw new HttpError(404, 'Case not found');
    if (!['pending', 'escalated'].includes(c.status)) throw new HttpError(409, 'Case is already decided');
    const items = obj(body.items, 'items');
    const allowed = new Set(CHECKLISTS[c.kind].map(i => i.key));
    const cur = parseJson(c.checklist, {});
    for (const [k, v] of Object.entries(items)) {
      if (!allowed.has(k)) throw new HttpError(400, `Unknown checklist item: ${k}`);
      cur[k] = v ? { checked: true, by: user.displayName, at: Date.now() } : undefined;
    }
    db.run('UPDATE eligibility_cases SET checklist = ? WHERE id = ?', JSON.stringify(cur), c.id);
    return caseView(db, db.get('SELECT * FROM eligibility_cases WHERE id = ?', c.id));
  }, staff);

  router.post('/api/staff/cases/:id/decision', ({ params, body, user }) => {
    const c = db.get('SELECT * FROM eligibility_cases WHERE id = ?', Number(params.id));
    if (!c) throw new HttpError(404, 'Case not found');
    if (!['pending', 'escalated'].includes(c.status)) throw new HttpError(409, 'Case is already decided');
    const decision = oneOf(body.decision, 'decision', ['approve', 'deny', 'escalate'], { required: true });
    const reason = str(body.reason, 'reason', { max: 500 });
    const provisional = parseJson(c.provisional, {});
    const checklist = parseJson(c.checklist, {});
    const now = Date.now();

    if (decision === 'escalate') {
      if (c.status === 'escalated') throw new HttpError(409, 'Already escalated');
      db.run(`UPDATE eligibility_cases SET status='escalated', recommended_by=?, decision_reason=? WHERE id=?`, user.id, reason, c.id);
      db.audit(user, 'case.escalate', `case:${c.id}`);
    } else if (decision === 'deny') {
      if (!reason || reason.length < 5) throw new HttpError(400, 'A reason is required to deny');
      db.run(`UPDATE eligibility_cases SET status='denied', decided_by=?, decided_at=?, decision_reason=? WHERE id=?`, user.id, now, reason, c.id);
      db.audit(user, 'case.deny', `case:${c.id}`);
    } else {
      if (!hasRole(user, c.requires_role)) throw new HttpError(403, `Approval requires the ${c.requires_role} role. Escalate this case instead.`);
      if (c.kind === 'upgrade' && c.created_by === user.id) throw new HttpError(403, 'Four-eyes rule: an upgrade must be approved by a different person than the one who opened it.');
      const missing = effectiveChecklist(c.kind, provisional).filter(i => i.required && !checklist[i.key]?.checked);
      if (missing.length) throw new HttpError(400, 'Complete all required verification steps before approving', { missing: missing.map(m => m.key) });
      if (c.kind === 'lounge' && provisional.result !== 'likely' && (!reason || reason.length < 10)) {
        throw new HttpError(400, 'The rules did not indicate eligibility. Give a reason (min 10 characters) to approve, e.g. paid entry receipt seen.');
      }
      const code = c.kind === 'lounge' ? refCode() : null;
      db.run(`UPDATE eligibility_cases SET status='approved', decided_by=?, decided_at=?, decision_reason=?, ref_code=?, ref_expires=? WHERE id=?`,
        user.id, now, reason, code, code ? now + 12 * 3600 * 1000 : null, c.id);
      db.audit(user, 'case.approve', `case:${c.id}`, { kind: c.kind });
    }
    return caseView(db, db.get('SELECT * FROM eligibility_cases WHERE id = ?', c.id));
  }, staff);

  router.post('/api/staff/cases/:id/verify-loyalty', async ({ params, body, user }) => {
    const c = db.get('SELECT * FROM eligibility_cases WHERE id = ?', Number(params.id));
    if (!c) throw new HttpError(404, 'Case not found');
    const loyalty = integrations.active('loyalty');
    if (!loyalty) throw new HttpError(503, 'Loyalty verification service is not connected. Verify the membership card or app manually.');
    const memberNumber = str(body.memberNumber, 'memberNumber', { required: true, pattern: /^\d{6,15}$/ });
    const lastName = str(body.lastName, 'lastName', { required: true, max: 60 });
    const res = await fetch(joinUrl(loyalty.config.baseUrl, 'members/verify'), {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(loyalty.config.apiKey ? { Authorization: `Bearer ${loyalty.config.apiKey}` } : {}) },
      body: JSON.stringify({ memberNumber, lastName }), signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new HttpError(502, `Loyalty service error (${res.status})`);
    const data = await res.json();
    const result = { verified: !!data.verified, tier: typeof data.tier === 'string' ? data.tier.slice(0, 30) : null, at: Date.now(), by: user.displayName, memberLast4: memberNumber.slice(-4) };
    const inputs = parseJson(c.inputs, {});
    inputs.loyaltyCheck = result; // member number itself is never stored
    db.run('UPDATE eligibility_cases SET inputs = ? WHERE id = ?', JSON.stringify(inputs), c.id);
    db.audit(user, 'case.loyalty_check', `case:${c.id}`, { verified: result.verified });
    return result;
  }, staff);

  // ---- Conversation transcripts (opt-in, consent-based, auto-expiring) ----
  router.post('/api/staff/transcripts', ({ body, user }) => {
    if (!db.getSetting('store_transcripts', false)) throw new HttpError(403, 'Transcript storage is disabled by the administrator');
    if (!bool(body.consent)) throw new HttpError(400, 'Passenger consent is required to save a transcript');
    const passengerLang = str(body.passengerLang, 'passengerLang', { required: true, pattern: LANG_RE });
    const staffLang = str(body.staffLang, 'staffLang', { required: true, pattern: LANG_RE });
    const entries = arr(body.entries, 'entries', { max: 300 }).map((e, i) => ({
      side: oneOf(e?.side, `entries[${i}].side`, ['passenger', 'staff'], { required: true }),
      original: str(e.original, 'original', { max: 1000 }) ?? '', translated: str(e.translated, 'translated', { max: 1000 }) ?? '',
      from: str(e.from, 'from', { pattern: LANG_RE }), to: str(e.to, 'to', { pattern: LANG_RE }), engine: str(e.engine, 'engine', { max: 80 }), at: Number(e.at) || Date.now(),
    }));
    if (!entries.length) throw new HttpError(400, 'Nothing to save');
    const days = Number(db.getSetting('transcript_retention_days', 7));
    const now = Date.now();
    const r = db.run('INSERT INTO transcripts(staff_user_id,passenger_lang,staff_lang,entries,consent,created_at,expires_at) VALUES(?,?,?,?,1,?,?)',
      user.id, passengerLang, staffLang, JSON.stringify(entries), now, now + days * 86400000);
    db.audit(user, 'transcript.save', `transcript:${r.lastInsertRowid}`, { entries: entries.length });
    return { id: Number(r.lastInsertRowid), expiresAt: now + days * 86400000 };
  }, staff);
}
