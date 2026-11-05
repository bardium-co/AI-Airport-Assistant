# AI Airport Assistant — Hamad International Airport (DOH)

A mobile-first, multilingual voice and text assistant with three modes:

| Mode | Who | What |
|---|---|---|
| **Passenger** (no sign-in) | Travellers | Text & voice questions in **51 languages**, spoken answers, live departures board and flight → gate lookup, terminal map with walking routes (step-free option), nearest facilities, lounge suggestions ranked by eligibility and walking distance, FAQs, staff-issued verification codes |
| **Staff** | Airport, lounge & airline staff | **Live passenger requests** (see, claim and answer passengers' messages from anywhere in the terminal), face-to-face two-way voice interpreter with original + translated transcripts, reviewed quick phrases, approved guidance (Privilege Club, lounge access, Qcredits, upgrades), eligibility cases with mandatory verification checklists and recorded approvals |
| **Admin** | Administrators | Map/locations/gates, lounges & opening hours & access rules, FAQs, languages, guidance, users & roles, integrations, simulated flights, privacy settings, privacy-protected analytics, audit log |

> **Honesty by design.** The terminal map is an **approximation built from public airport information** and is labelled as such everywhere; demo flights are **clearly labelled simulated data**. Lounge access rules follow the official HIA lounge pages, and opening hours that are not published are shown as "check with the lounge" — never invented. The app never invents live flight data and never shows an integration as connected unless an administrator has configured it, confirmed it is **authorised**, enabled it, **and** a live connection test passed.

## Quick start

Requirements: **Node.js 22.13+** (uses the built-in `node:sqlite`). No npm packages are needed.

```bash
npm start                 # http://127.0.0.1:3000  (demo mode)
npm test                  # 149 unit/integration/security tests
node tests/e2e/browser-e2e.mjs http://127.0.0.1:3000   # 21-step browser test (needs Chrome or Edge)
```

Demo accounts (demo mode only, shown on the staff sign-in page): `staff / Staff#2026demo`, `supervisor / Super#2026demo`, `admin / Admin#2026demo`.

**Demo scenario:** choose हिन्दी, tap the microphone and say *"QR 572 का गेट कौन सा है?"*. The assistant answers aloud in Hindi with the **simulated** gate C9, the walking time from your location, the gate-closing reminder and a spoken "simulated data" warning, then offers **मुझे रास्ता दिखाएँ** (show me the way).

Voice input requires a secure context: use `http://localhost` for testing, and HTTPS (behind a reverse proxy) for phones and kiosks.

## Architecture

```
server/                 Node.js HTTP server (no framework, no dependencies)
  app.js                routing, auth guard, CSRF, rate limits, error handling
  auth.js               scrypt passwords, server-side revocable sessions, lockout, roles
  db.js / seed.js       SQLite schema + clearly-labelled seed data (sources linked)
  routes/               public · staff · admin APIs
  services/
    assistant.js        intent routing → deterministic, reviewed answers; LLM for understanding + grounded answers
    nlu.js              script-based language detection, native digits, spoken airline names, flight/gate extraction
    phrases.js          answer templates (12 core languages) + loader for public/lang/*.json language packs
    llm.js              OpenAI-compatible client, primary→fallback chain, <think> stripping
    translate.js        reviewed phrasebook → LibreTranslate → LLM translation
    flights.js          airport feed · AeroDataBox · AirLabs adapters, cached departures board / simulated demo table (never mixed)
    maps.js             Dijkstra wayfinding, step-free routing, closed-location handling
    eligibility.js      provisional lounge rules engine (never grants access)
    integrations.js     provider registry, AES-256-GCM secret storage, honest status
    analytics.js        aggregate-only counts with small-cell suppression
public/                 Vanilla-JS SPA (PWA): passenger, staff and admin views, SVG map, Web Speech
tests/                  node:test suites + dependency-free Chrome DevTools E2E harness
```

### How the AI is kept accurate
1. **Facts never come from the model.** Gates, times, walking distances, lounge rules and FAQ answers come from the database and reviewed templates.
2. The model is used to **understand** unusual phrasing in any language (returns structured intent JSON). Any flight or gate number it suggests must appear literally in the passenger's message.
3. For open questions the model answers **only from approved FAQ facts**. A grounding guard rejects any answer containing a gate, flight, price or number not present in those facts; the passenger then gets the safe fallback. AI answers are labelled.

### Built-in AI (Qwen3, runs inside the app)
The app includes its own AI engine (llama.cpp via `node-llama-cpp`). An open-source **Qwen3** model runs inside the app's server, so there is no Ollama or other program to install, and tablets, kiosks and phones need nothing at all. Passenger text never leaves the server. All three models are **Apache-2.0** (commercial use allowed) and support 119 languages. Qwen 2.5 3B was deliberately not used: it is under a research-only licence.

| Model | Download | Use when |
|---|---|---|
| `qwen3-4b` (default) | 2.5 GB | Normal laptop, 8 GB+ RAM |
| `qwen3-1.7b` | 1.8 GB | Older laptop, 4 GB RAM |
| `qwen3-8b` | 5 GB | Strong PC, 16 GB RAM, ideally a graphics card |

**Setup:** run `npm run ai-setup` once (or press **Download** in Admin → Integrations → *Built-in AI*), then press **Turn on**. That one step:
* sets the built-in model as *AI language model (primary)*;
* sets *Machine translation* to use the model, so passenger ↔ staff messages and help topics are translated in every language;
* runs a live test of the model.

On a laptop without a graphics card, expect a few seconds per answer. Passengers are never kept waiting: the rules-based assistant answers known questions instantly, and messages to staff are translated in the background.

### Open-source / Chinese models (hosted alternatives)
Admin → Integrations → *AI language model (primary/fallback)*. Any OpenAI-compatible endpoint works:

| Option | Base URL | Example model |
|---|---|---|
| **Ollama** (local, free) — `ollama pull qwen3:8b` | `http://127.0.0.1:11434/v1` | `qwen3:8b`, `deepseek-r1:8b`, `qwen2.5:7b-instruct` |
| vLLM / LM Studio / llama.cpp | `http://127.0.0.1:8000/v1` | `Qwen/Qwen3-8B` |
| DeepSeek API | `https://api.deepseek.com/v1` | `deepseek-chat` |
| Alibaba Qwen (DashScope) | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` | `qwen-plus` |
| Zhipu GLM | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-flash` |
| OpenRouter | `https://openrouter.ai/api/v1` | `qwen/qwen3-32b` |

Set *Machine translation → Use the configured AI language model* (or self-host **LibreTranslate**) to enable free-text interpreter translation and machine-translated answers for languages beyond the 51 built-in ones (and FAQ answers in every language). Without a provider, the interpreter still works with the reviewed quick-phrase book and says so.

**Speech:** device Web Speech API by default (Chrome/Edge/Safari). For on-premises recognition, connect a Whisper-compatible server (e.g. faster-whisper-server) under *Speech recognition*.

## Message airport staff (passenger help requests)
When the app cannot answer, passengers can message staff without walking to a desk. The **Message airport staff** button appears on the home screen, on the Help screen, and inside any answer the assistant could not give.
* **Passenger:**
  * types the request in their own language, with their location and optional flight number;
  * gets a request code (e.g. `H-TM9B`) and a live conversation screen that refreshes every 4 seconds;
  * sees "A staff member is helping you" once someone takes the request;
  * can reply or close the request.

  Passengers stay anonymous: the conversation can only be opened on the device that created it, through a private token stored hashed on the server.
* **Staff:**
  * **Requests** is the first tab of the staff console. It shows a red badge with the number of new requests and plays a sound when one arrives. Requests are listed by waiting time, with language, location (with a *Show on map* link), flight and a message preview.
  * Staff can open a request, press *I'm handling this*, and reply. Quick replies are reviewed translations in all 51 languages, including "A staff member is on the way to you" and "Please go to the nearest information desk". Free text is machine-translated when a translation provider is connected; otherwise it is sent in English and labelled as such.
  * Staff can close a request; claims and closures are written to the audit log.
* **Limits and privacy:** a device can open 5 new requests at once, then 1 more per minute. Requests are deleted automatically after 7 days (Admin → Privacy & settings).

## Live flight data
The airport's own departures page loads its data from the airport's internal systems, which are not an open API, so this app does not copy it. Live flights come from one of these sources, configured under **Admin → Integrations → Live flight data**:

| Provider | What you need | Notes |
|---|---|---|
| **Airport flight feed** (best) | Authorised AODB/FIDS JSON feed from the airport | Contract below. Gates come straight from the airport. |
| **AeroDataBox** | API key from aerodatabox.com (Direct, `X-Api-Key`) or RapidAPI | Full data: airline names, destination cities, terminal, gate, live status. The departures board uses `/flights/airports/iata/DOH` (12-hour window). |
| **AirLabs** (current choice) | API key from airlabs.co (free plan available) | Codes only, so cities come from the built-in airport list (280 airports). The free plan returns 50 flights per request (set *Pages per refresh*) and may omit gates, status and terminals. The connection test reports what your key returns. Set a *Daily request budget* and refreshes are spread across the day so the quota lasts. |

1. Sign up with the provider and choose a plan that allows commercial use. The free and basic plans are small and for non-commercial use only.
2. Admin → Integrations → choose the provider, paste the key, keep the airport as `DOH`, tick **Authorised** and **Enabled**, and press **Test**. Data is shown as live only after the test passes.
3. Passengers see a **departures board** on the Flight screen, with search, refreshed every 60 seconds. They also see the source ("Live · AeroDataBox") and the time of the last update.

**Quota protection:** the board is cached (Admin → Privacy & settings → *Live flight data cache*, default 120 s), and single-flight questions are answered from the cached board first.

**Outages:** if the provider fails, a board less than 15 minutes old is shown marked "last update". Anything older is never shown, and simulated data is never substituted.

## Languages (51)
The 12 core languages are English, Arabic, Hindi, Urdu, Bengali, Malayalam, Filipino, Chinese (Simplified), French, Spanish, Russian and German. The 39 language packs in `public/lang/` add:
* **East and Southeast Asia:** Japanese, Korean, Chinese (Traditional), Thai, Vietnamese, Indonesian, Malay.
* **Europe:** Turkish, Italian, Polish, Portuguese, Dutch, Greek, Ukrainian, Romanian, Czech, Hungarian, Swedish, Danish, Norwegian, Finnish.
* **Middle East and Central Asia:** Persian, Hebrew, Pashto, Azerbaijani, Uzbek, Kazakh.
* **South Asia:** Nepali, Sinhala, Tamil, Telugu, Kannada, Marathi, Gujarati, Punjabi.
* **Africa:** Swahili, Amharic, Somali.
* **Regional variant:** Spanish (Mexico) with a Mexican voice.

Each pack contains the full interface, every spoken answer template (gate, flight, walking time, lounges, the gate-closing rule, the simulated-data warning), keywords for places and intents, and the staff quick-phrase book.

The answer language switches automatically by writing system: kana means Japanese and Hangul means Korean, and Thai, Hebrew, Greek, Ethiopic, Sinhala, Telugu, Kannada, Gujarati and Gurmukhi are detected the same way. Within the Arabic script, Persian, Pashto and Urdu are told apart; within Cyrillic, Kazakh and Ukrainian. Typing in a script that your chosen language shares keeps your choice.

**Translation review:** the packs added on 2026-11-05 are AI-drafted translations, marked `review` in each file. Have a native speaker review each one before go-live. Help-topic (FAQ) answers exist in English, Hindi and Arabic; other languages show them in English, or machine-translate them once a translation provider or AI model is connected.

**Adding a language:** copy a pack, translate it, and run `npm test`. The validator checks every key, placeholder, keyword and phrase.

### Integration placeholders (contracts)
* **Flight feed** — `GET {base}/flights/{QR572}` → `{flightNo, airline, destination, destinationCode, scheduledDeparture, estimatedDeparture?, terminal?, gate?, status}`; optional `GET {base}/departures` → array of the same (departures board); `GET {base}/health`. When connected, simulated flights are never used; feed errors are reported, never replaced by simulation.
* **Indoor maps** — `GET {base}/venues/{venueId}` for the test; geometry is imported via Admin → Map (JSON export/import).
* **Loyalty** — `POST {base}/members/verify {memberNumber, lastName}` → `{verified, tier}`. Member numbers are never stored (last 4 digits only).

## The terminal map (approximate, from public information)
The official interactive map on dohahamadairport.com is a licensed **Visioglobe** indoor map loaded with the airport's private key; its data is **not** copied into this app. Instead, the seed map (v2) is drawn from facts stated in public text on the official HIA pages (checked 2026-11-05):

* **Layout:** Lamp Bear in the **South Plaza** with Concourses **A** and **B** next to it; the **ORCHARD** in the Central Concourse; **Concourse C** running to the **North Node** (Oryx Garden Hotel, C-gates food court, Sleepover near C30/C31); a walkway to **Concourses D & E**; the **passenger train** between the South and North plazas (carts and strollers not allowed); complimentary **shuttle buggies** between Concourse B (near Lamp Bear) and Concourse E (near E1).
* **Gates:** A1–A10, B1–B10, C1–C31, D1–D9, E1–E8 (D = 9 and E = 8 contact gates per March 2025 press reports; C31 is referenced on the official Sleepover page). Positions are approximate.
* **Lounges (10):** each placed on its official concourse/level/landmark (for example Gold Lounge South: Concourse A, Level 1, near Gate A1), with access rules summarised from its official page.
* **Facilities:** transfer halls A–D, information desks (Lamp Bear, ORCHARD, A, B, C, walkway to D & E), five activity nodes (A, B and three in C), the Muzn sensory room (C7–C9), Oryx Airport Hotel and the Vitality gym/pool/spa (4th floor, 06:00–02:00), sleep pods, prayer and quiet rooms, toilets, smoking rooms and food.
* **Routing:** walking distances use about 1.9 m per map unit, and the train is weighted by ride plus waiting time (Admin → Privacy & settings → *Passenger train*, default 4 min). Opposite concourses come out at about 20 minutes, which matches public guides.

Everything is labelled *approximate*. Replace it with authorised indoor-map data before go-live, for example from the airport's Visioglobe licence through Admin → Map import or the indoor-map integration. A database seeded with the old v1 map upgrades automatically, unless an administrator has edited the map or lounges; in that case nothing is overwritten.

## Security & privacy
* scrypt password hashing, 12+ character policy, 15-minute lockout after 5 failures, no username enumeration.
* HttpOnly + SameSite=Strict session cookies (Secure in production), server-side revocation on logout/role change, CSRF token on all staff/admin writes.
* Roles: staff < supervisor < admin. Upgrades need a supervisor **and** a different person from the case opener (four-eyes rule).
* Strict CSP (no inline scripts), `X-Frame-Options: DENY`, nosniff, microphone-only Permissions-Policy, body-size limits, rate limits, parameterised SQL, path-traversal protection.
* Passengers are anonymous. Analytics store only daily counts of topic + language + mode; counts below 5 are suppressed. Interpreter transcripts are **off by default**, require passenger consent, auto-delete, and every view is audited.

## Running it at the airport (tablets, kiosks, passenger phones)
One computer runs the app: the "server", for example a staff laptop, or better an always-on PC. Every tablet, kiosk and phone simply opens its address over the airport network. If that computer is off, the devices cannot work, so keep it on and plugged in.

1. **On the server computer:** `npm install`, `npm run ai-setup`, then `npm run make-cert` (HTTPS is required for the microphone on tablets and phones).
2. **Start it:** `npm run start:airport`. It prints the address to use, e.g. `https://192.168.1.6:3000`.
3. **On each tablet or kiosk, once:**
   * install `data/airport-assistant-ca.crt` (Android: Settings → Security → Encryption & credentials → Install a certificate → CA certificate);
   * open the printed address in Chrome;
   * tap **⋮ → Install app** (or *Add to Home screen*). It then opens full-screen like a normal app, with no app store or APK needed.
   * For kiosks, also turn on Android *App pinning* (or a kiosk-browser app) so passengers cannot leave the app.
4. **Passengers' own phones** reach the same address over the airport Wi-Fi, for example through a QR code on the kiosks. Phones would show a certificate warning with the self-made certificate, so for public use ask airport IT for a certificate for a real host name, then set `HTTPS_PFX` / `HTTPS_PFX_PASSWORD`.

## Going live — checklist
1. `NODE_ENV=production`, `APP_SECRET` (≥32 chars), `ADMIN_USERNAME`, `ADMIN_PASSWORD`, run behind HTTPS (`TRUST_PROXY=true` if behind a proxy). Production mode creates no demo accounts and hides simulated flights.
2. Replace the approximate map with authorised indoor-map data (import JSON) and only then untick *Label the map as approximate*.
3. Confirm lounge positions, opening hours and access rules with the operators; untick *Simulated* per lounge.
4. Replace seed guidance with authorised airline wording and have supervisors approve it.
5. Connect only **authorised** integrations (flight feed, loyalty, models) and pass their connection tests.
6. Review FAQs (each has a source URL and verification date) and enable additional languages once translation is connected.

## Configuration (environment)
`PORT` (3000) · `HOST` (127.0.0.1; use 0.0.0.0 behind a proxy) · `DATA_DIR` (./data) · `NODE_ENV` · `DEMO_MODE` · `APP_SECRET` · `ADMIN_USERNAME` · `ADMIN_PASSWORD` · `SESSION_HOURS` (10) · `TRUST_PROXY` · `SECURE_COOKIES`. `npm run reset-db` re-seeds the database.

## Data sources (public, verify before go-live)
FAQ facts, lounge rules and map landmarks come from the official Hamad International Airport pages, and each FAQ and lounge stores its source link: transfers, prayer rooms, medical & emergencies, connectivity, special assistance, facilities (information desks, shuttle buggy, strollers, Travelex and more), relax (ORCHARD, Oryx hotels, Vitality, Sleepover, play areas, quiet rooms) and every page under /lounge/. Gate counts for D and E come from press reports (Gulf Times and Oman Observer, March 2025). Map positions are **approximate** and lounge opening hours are **not confirmed**. Privilege Club / Qcredits guidance summarises public sources and is marked as a simulated approval until replaced with authorised text.
