# Put it on the internet for free (Netlify) — "Lite" edition

No server to buy or look after. Staff and passengers just open a web address; tablets add it to the home screen.
Works on any device, any shift, any computer — nothing has to be left switched on.

**What you get:** the full passenger app (51 languages, voice, map and routes, lounges, FAQs, flights),
and **Message airport staff** with a staff login and live request list. **What is left out:** the admin console,
lounge-eligibility cases, and the built-in AI model (there is no server to run it on). Questions are answered by the
app's own rules, which is what you asked for.

## Deploy (about 10 minutes)
1. Make a free account at https://netlify.com (sign in with GitHub).
2. **Add new site → Import an existing project → GitHub →** pick `AI-Airport-Assistant` (private repos work once
   you allow it). Netlify reads `netlify.toml`, so leave every build setting as it is → **Deploy**.
3. **Site configuration → Environment variables → Add a variable**, then **Deploys → Trigger deploy** so they take effect:

| Variable | Required | Value |
|---|---|---|
| `STAFF_ACCOUNTS` | **yes** | Staff logins, e.g. `anna:Her-Long-Pass-91:Anna K;omar:Another-Pass-77:Omar S` — `username:password:Display name`, separated by `;`. Passwords need 8+ characters and no `:` or `;`. Add or remove people any time, then redeploy. |
| `SESSION_SECRET` | recommended | Any random text, 32+ characters. Changing it signs everyone out. |
| `AIRLABS_API_KEY` | for live flights | Your AirLabs key. Without it the board shows clearly labelled **simulated** flights. |
| `AIRLABS_DAILY_BUDGET` | optional | Max AirLabs requests per day (default 30) so a small free quota lasts all month. |
| `LIBRETRANSLATE_URL` / `LIBRETRANSLATE_KEY` | optional | A LibreTranslate server, so typed staff replies and passenger messages are machine-translated. Without it, only the **quick replies** are translated (51 languages) and typed replies go out in English. |
| `SUPPORT_RETENTION_DAYS` | optional | Days to keep help requests before they are deleted (default 7). |

4. Open `https://<your-site>.netlify.app`. Staff sign in at `https://<your-site>.netlify.app/#/staff`.
   You can rename the address under **Site configuration → Change site name**.
5. **Tablets/kiosks:** open the address in Chrome → ⋮ → **Install app**. There is no certificate to install:
   Netlify provides HTTPS, so the microphone works everywhere.

Keys and passwords live only in Netlify's settings — never in the code or in the browser.

## Try it on your computer first
`npm run lite` → http://localhost:8888 (staff sign-in `staff` / `Staff-Pass-2026`). Requests are kept in memory only.

## Honest limits
* **Free-plan allowance.** Netlify meters function calls and storage on the free plan, and its limits change — check
  your account's current allowance. Screens poll for new messages, so a staff screen left open all day is the main
  consumer (15 s between checks; paused when the tab is hidden). Close the staff tab when off shift.
* **Flight quota.** The flight board is cached and shared between function instances so the AirLabs quota is spent
  slowly. Whether the AirLabs free plan includes gates and status depends on your key.
* **Typed staff replies are in English** unless `LIBRETRANSLATE_URL` is set. Use quick replies for non-English passengers.
* **No live AI.** Messy sentences are handled by the rules and the speech-repair layer, not a language model.
* **Staff sessions** cannot be revoked individually: remove the person from `STAFF_ACCOUNTS` (or change
  `SESSION_SECRET`) and redeploy.
* **Public site = public data.** Passenger messages are stored on Netlify's servers (outside the airport) for 7 days.
  Tell passengers not to send passport or card numbers, and check the airport's data rules before going live.
* This edition was tested locally and in an automated browser; it has not been deployed to Netlify from this machine.

## If something goes wrong
| Symptom | Fix |
|---|---|
| Staff sign-in says accounts are not set up | `STAFF_ACCOUNTS` missing or passwords shorter than 8 characters — fix it, then trigger a deploy. |
| API calls fail with `No such built-in module: node:sqlite` | Add the variable `AWS_LAMBDA_JS_RUNTIME` = `nodejs22.x` and redeploy (needs Node 22.13 or newer). |
| Languages other than English show English words | The `public/lang` files were not packaged: check **Deploys → Functions** shows `api`, and that `netlify.toml` is at the repo root. |
