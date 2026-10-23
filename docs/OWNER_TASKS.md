# Owner tasks — step by step (production readiness)

Written 2026-10-23. Do these in any order, then tell the assistant "tayyor". **Never paste a token, password, key file or card number into the chat.** Where a secret is needed it is typed at a hidden prompt, on your PC or on the server.

Checklist: [ ] 1 Domain · [ ] 2 Two bots · [ ] 3 Signing key · [ ] 4 Backup key (+ bucket) · [ ] 5 Legal text · [ ] 6 Second admin · [ ] 7 Bank/legal · [ ] 8 Decisions

---

## 1. Production domain and DNS
You need a domain name for the production API, e.g. `api.yourbrand.uz` (staging stays `staging.sultonxoja.uz`).
1. Buy or pick a (sub)domain you control.
2. In its DNS panel add an **A record**: name = the host (e.g. `api`), value = `169.58.84.10`, TTL = 300 or the lowest allowed. No AAAA record.
3. Check from your PC (PowerShell): `nslookup api.yourbrand.uz` — the answer must show `169.58.84.10`. Propagation can take minutes to a few hours.
4. Tell the assistant the exact domain. (The server gets its HTTPS certificate by itself once the name points there; it stays closed to everyone except your IPs until you open it.)

## 2. Two NEW Telegram bots (customer + taxi)
Production must not reuse the test bots.
1. In Telegram open **@BotFather** → `/newbot`.
2. First bot = the customer bot. Name e.g. `DS Delivery`, username must end with `bot`, e.g. `ds_delivery_uz_bot`.
3. Second bot = the taxi operator bot. Name e.g. `DS Taxi`, username e.g. `ds_taxi_ops_bot`.
4. BotFather gives each a **token**. Save both in your password manager. **Do not send them to the assistant.** They are typed later at a hidden prompt on the server (`set-secret.sh BOT_TOKEN` / `TAXI_BOT_TOKEN`).
5. Optional polish in BotFather: `/setdescription`, `/setuserpic`, `/setcommands` for the customer bot. The Mini App menu button is set by the backend.
6. Tell the assistant only the two **usernames**.
7. Start each bot once yourself (`/start`) so you can receive its messages.

## 3. APK signing key (one for both apps)
Losing this file or its password means installed apps can never be updated. Do it once, keep two copies.
1. On your PC open PowerShell in the project folder (`C:\Users\Acer\Documents\DS`).
2. Run: `powershell -ExecutionPolicy Bypass -File scripts\create-release-keystore.ps1`
3. Type a strong password (12+ characters) twice at the hidden prompts. The key is created at `C:\Users\Acer\DS-secrets\ds-release.jks`.
4. **Copy `ds-release.jks` to two different safe places** (for example an encrypted USB drive and a cloud vault) and **store the password in your password manager** (not in a text file next to the key).
5. Tell the assistant "keystore tayyor". It builds the release APKs with `scripts\build-release-apks.ps1`; you type the password at a hidden prompt (or the assistant asks you to run the command yourself).
6. Never commit it to Git (`*.jks` is ignored) and never send it by chat/e-mail.

## 4. Backup encryption key (+ optional cloud bucket)
Backups of the database, receipts and the Gmail token are encrypted with `age` before they leave the server. Only you can decrypt them.
1. Install `age` on your PC: download the Windows zip from https://github.com/FiloSottile/age/releases (the `age-…-windows-amd64.zip`), unzip into e.g. `C:\Tools\age`.
2. In PowerShell: `C:\Tools\age\age-keygen.exe -o C:\Users\Acer\DS-secrets\ds-backup-key.txt`
3. The command prints a line `Public key: age1…`. **That public line is the only thing you send to the assistant.**
4. **The file `ds-backup-key.txt` is the private key**: keep two copies in two safe places (same rule as the signing key). Without it the backups cannot be opened.
5. Recommended: an S3-compatible bucket for the offsite copy (Backblaze B2, Contabo Object Storage, Cloudflare R2…). Create a private bucket and an access key limited to that bucket. Give the assistant the provider name, bucket name and region/endpoint; the key id and secret are typed by you at the server (`rclone config` / `set-secret.sh`), never in chat. Without a bucket the encrypted copies stay on the server and on your PC only (less safe if the VPS is lost).

## 5. Legal operator text
The privacy and terms pages in the customer app stay "not ready" until these two values exist.
1. `LEGAL_OPERATOR_NAME`: the legally responsible party, exactly as it should appear (individual entrepreneur or company name, e.g. `YaTT Familiya Ism` / `"Nom" MChJ`), plus its tax number if you want it shown.
2. `LEGAL_OPERATOR_CONTACT`: a phone number and/or Telegram handle/e-mail customers can reach.
3. Send these two lines to the assistant (they are public by design). Ask a lawyer to read the generated `/legal/privacy` and `/legal/terms` text before the public launch: the pages describe what is stored, they are not legal advice.

## 6. Second administrator
Two equal administrators receive card approvals and unmatched-money alerts, so nothing waits for one person.
1. The second person opens **@userinfobot** in Telegram and sends `/start`; it replies with a numeric `Id`.
2. They also press `/start` in your production customer bot (otherwise the bot cannot message them).
3. Send the numeric id to the assistant. (Your own id is already known.)

## 7. Bank and legal confirmation (before real customers)
1. Ask the bank that issued each restaurant card whether a business may receive customer payments for orders on that card, and whether the bank sends an e-mail notification for each incoming transfer (the system reads these). Ask about any daily limits.
2. Make sure the **card holder is the restaurant (or its owner who authorised it)**; you will call them to approve the card by phone.
3. Data location: ask a lawyer whether hosting the personal data (names, phones, addresses) at the VPS provider and in its country meets Uzbekistan's personal-data rules for your case.
4. Restaurant agreement: commission (5 000 UZS per delivered order, weekly), who refunds, working hours. Taxi operator agreement: tariffs and who handles problems.

## 8. Decisions the assistant needs from you
- **Sign-up**: open to everyone, or invite-only for the first pilot (recommended: invite-only).
- **APK distribution**: send the APK file directly (simplest for the pilot) or Google Play (needs a developer account and review).
- **Pilot size**: one restaurant + one taxi operator, at least 5 controlled real orders before opening wider (recommended).
- **Real restaurant data**: name, address, phone, menu with prices, working hours, staff Telegram id (for "new paid order" alerts); taxi operator Telegram id and tariffs.

---

## What happens after you finish
1. You say "tayyor". 2. The assistant builds the release APKs and, with your go (about 10 seconds of staging downtime), deploys the new release to staging. 3. You run the one test batch in `docs/PENDING_MANUAL_TESTS.md` §H. 4. The assistant brings production up locked to your IP; you place the Gmail files (`credentials.json`, `gmail-token.json` from `KARTA\ds3`) and type the bot tokens at the hidden prompts. 5. Real-money rehearsal with your own cards (`docs/RUNBOOK_PRODUCTION.md` §5 R1–R11). 6. Only then the production door is opened.

Related: `docs/RUNBOOK_PRODUCTION.md` (server steps), `docs/PROD_READINESS.md` (full gap list), `docs/STAGE_8C.md` (what was built).
