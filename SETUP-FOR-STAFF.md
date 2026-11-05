# AI Airport Assistant — setup for staff (no server, no cost)

No cloud, no subscription, no AI model to download. One Windows PC runs the assistant; tablets, kiosks and
staff devices just open its address in a browser.

## 1. Choose the "host" PC  (important with shift work)
The host PC must be **switched on and on the airport Wi-Fi/LAN whenever passengers need the app**.
Shifts do not matter if staff only *use* the system from their own devices:

* **Pick ONE PC to be the host** (a spare desktop at the staff desk is ideal — leave it plugged in, set to never sleep).
* **Every staff member signs in from any device** (their own laptop, a tablet, a phone) at the same address.
  They do not run anything themselves, so the shift change does not interrupt it.
* If the host PC must be switched off or swapped: see *Moving to another PC* below.

Ask airport IT (or the Wi-Fi router's admin) for **one thing**: give the host PC a *reserved IP address*
("DHCP reservation"). Otherwise its address can change after a restart and every tablet would need updating.

## 2. Start it (first time, ~5 minutes, needs internet once)
1. Install **Node.js LTS** from https://nodejs.org (accept the defaults).
2. Copy this whole folder to the host PC (e.g. `C:\AirportAssistant`).
3. Double-click **Start-Airport-Assistant.bat**. First start installs itself and creates the secure certificate.
4. It prints addresses such as `https://192.168.1.6:3000` — **that is what the tablets open.** Keep the window open (minimise it).
5. Optional but recommended: right-click `tools\autostart.ps1` → *Run with PowerShell*. The assistant then starts
   automatically whenever anyone signs in to that PC.

## 3. Each tablet / kiosk (once)
1. Copy `data\airport-assistant-ca.crt` to the tablet (USB or email) and install it:
   Android → Settings → Security → Encryption & credentials → Install a certificate → **CA certificate**.
2. Open the address from step 2.4 in Chrome.
3. Chrome menu **⋮ → Install app / Add to Home screen**. It now opens full-screen like a normal app.
4. Kiosks: also turn on Android *App pinning* so passengers cannot leave the app.

## 4. Before real use
* Sign in at `/#/login` with the demo admin account, open the **Admin console → Users**, create real staff
  accounts and **reset or disable the demo accounts** (their passwords are public in the README).
* Staff: sign in, open **Requests**. New passenger messages appear live with a sound; claim, reply, close.
  Passengers' messages arrive in their language; use the **quick replies** (translated in 51 languages).
* Typed replies are sent as written (English) unless a translation service is connected by the admin.
* Live flights: Admin → Integrations → AirLabs → paste the key. Until then the board shows clearly labelled
  *simulated* flights.

## 5. Moving to another PC / backups
* Weekly (or before any change): `tools\backup.ps1 -To E:\assistant-backup` (USB stick or shared drive). The backup contains the accounts and the key that protects saved integration keys — keep the USB stick locked away.
* On the new PC: do step 2, close the assistant, then `tools\backup.ps1 -To E:\assistant-backup -Restore`,
  and run `tools\make-cert.ps1` again. **Tablets then need the new `.crt` installed**, and — unless you can give
  the new PC the *same IP address* as the old one — the new address.

## Troubleshooting
| Problem | Fix |
|---|---|
| Tablet cannot open the address | Same Wi-Fi as the host? Some guest Wi-Fi networks block devices from reaching each other — ask IT for "client isolation off", or use the staff network. Windows may ask to allow Node.js through the firewall: choose *Private networks* → Allow. |
| "Not secure" warning / microphone blocked | The `.crt` file is not installed on that tablet (step 3.1). |
| Works, then stops after a restart | The host PC's IP changed. Reserve its IP (step 1) and rerun `tools\make-cert.ps1`. |
| Window closed by accident | Double-click `Start-Airport-Assistant.bat` again. Nothing is lost. |
