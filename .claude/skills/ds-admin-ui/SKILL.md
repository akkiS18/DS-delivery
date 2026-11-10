---
name: ds-admin-ui
description: UI/UX rules and component kit of the DS Admin Android app (apps/admin-android). Use before adding or changing any screen, dialog, colour, text or icon in that app. Skip for the customer Mini App, restaurant/taxi apps, backend-only work and docs.
---

# DS Admin UI

Written from the code as it stands after the 2026-11-10 redesign (docs/ADMIN_UI_PLAN.md has the reasons and owner decisions). This skill covers **only** apps/admin-android. Money, PIN and login **logic** is never touched by a looks change; changing it needs the ds-backend-safety mindset (confirm dialogs, idempotent calls, honest messages).

## 1. Where things live (package `com.dsdelivery.admin.ui`)
| File | What |
|---|---|
| `Palette.kt` | Raw ARGB tokens (`Palette.Light/Dark`), `Contrast` helper. JVM-testable, no Compose. |
| `Theme.kt` | `DSAdminTheme` (follows the system dark mode), Manrope, type scale, shapes, `AmountStyle`, `LocalStatusColors`, and the getters `UrgentColor / WarnColor / InfoColor / OkColor / NeutralColor` (composable). |
| `Format.kt` | `somText`, `ageText`, `stampOf`, `clockOf`, `dayLabel`, `dialable`, `Tone` + `toneOf(severity)` + `severityLabel`. |
| `kit/Kit.kt` | The component kit (below). **Screens use only this** for cards, rows, chips, buttons, dialogs and empty/error/loading states. |
| `MainScreen.kt` | The four bottom tabs, the Pul chips, the Yana list, deep links from Diqqat cards, the home screen. |
| `MoneyTab.kt` | Also holds the shared shims `Card`, `Banner`, `PrimaryButton` (they render with the kit; prefer the kit names in new code). |
| `Calls.kt` | `unwrap(ApiResult, say)` turns server refusals into one Uzbek message. |

## 2. Tokens
- Neutral graphite + **one** accent: indigo `primary` (light `#4F5BD5`, dark `#A3AAFF`). Never add a second accent.
- Red `urgent`, amber `warn`, green `ok` (+ `info`, `neutral`) are **status colours only**. A status always carries text, and an icon where the kit gives one (colour is never the only signal).
- Colours come from `MaterialTheme.colorScheme` or the status getters. **No `Color(0x…)` in a screen.** Need a new colour → add it to `PaletteSet` for light **and** dark, and make `PaletteTest` cover every text pair (WCAG AA 4.5:1). Run the test; it fails if a pair is too weak.
- Font: Manrope variable (400–800). Do not set `fontFamily`, `fontSize` or `fontWeight` by hand when a `MaterialTheme.typography` style fits. Scale: displaySmall 28/800 (one big money figure), titleLarge 22, titleMedium 17, titleSmall 15, bodyLarge 16, bodyMedium 15, bodySmall 13, labelLarge 15, labelMedium 13.
- **Amounts and counters** use `.merge(AmountStyle)` (tabular digits). Money text always goes through `somText(Long)` → `12 300 000 söm`.
- Density: Material standard. Touch targets ≥ 48 dp (the kit buttons are 48 dp; rows ≥ 56 dp). Screen padding 16 dp; 12 dp between cards; card padding 16 dp, corners 16 dp, 1 dp `outline` border.

## 3. Components (`ui/kit/Kit.kt`) — what to use when
- `AdminCard(modifier, onClick?, highlight: Tone?) { … }` — every block of content. `onClick` makes the whole card tappable (do **not** wrap it in `clickable`). `highlight` is for "this is ringing / needs you now".
- `SectionHeader(title, action?)` — heading of a group. Not a bare `Text(titleMedium)`.
- `StatusChip(text, tone)` — a state ("Faol", "Tasdiq kutmoqda"). `Notice(text, tone)` — a full-width strip (offline, a warning before a money action).
- `ListRow(title, subtitle?, leading icon?, trailing?, onClick?)` — list entries (see the Yana list).
- `MetricTile(label, value, tone?, hint?, onClick?)` — a number with a label (home screen).
- Buttons: `PrimaryButton(text, onClick, modifier, enabled, loading, icon?)` = the ONE main action of a card/screen; `SecondaryButton` = the rest; `DangerButton` = delete/irreversible, **always** behind `ConfirmDialog`. Inside a `FlowRow` pass `Modifier` (no `fillMaxWidth`).
- `ConfirmDialog(title, message, confirmText, onConfirm, onDismiss, danger?, busy?)` — before money moves or something is removed. `confirmText` names the action ("Ha, ötkazdim"), never "OK". Say what will change in `message`.
- States: `EmptyState(title, hint?, icon?, action?)` (says why and what next), `ErrorState(onRetry)`, `LoadingSkeleton`, `ListPlaceholder(offline) { retry }` (skeleton, or the retry card when loading failed), `DetailHeader(title, onBack)` for a detail screen inside a tab.
- `FormField(value, onChange, label, hint?, error?)` — one label, one hint line, one error line. Validate on input, show the error under the field.
- No emoji in buttons, labels or titles (icons or `StatusChip` instead). A short emoji inside a snackbar message is tolerated but not needed.

## 4. Navigation (decided, do not add tabs)
Bottom bar, exactly four tabs: **Diqqat** (home: status strip, readiness notice, "Bugun" tiles, "Şoşilinç işlar" cards), **Pul** (chips: Tekşiruv, Hisobot, Qaytariş, Komissiya, Kartalar), **Murojaat**, **Yana** (list: Restoranlar, Taksi, Mijozlar, Aksiya, Joylar, Platforma, Sozlamalar). A new screen goes into one of these (usually a Pul chip or a Yana row) and gets a deep link from the Diqqat card that needs it (`destFor(kind)` in MainScreen.kt). Back: closes an opened Yana screen, then returns to Diqqat, only then leaves the app. Detail screens inside a tab use `DetailHeader` + their own `BackHandler`.

## 5. A list screen, the usual shape
```
PullRefresh(onRefresh = { scope.launch { load() } }) {
  LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
    if (offline) item { Banner("Ulaniş yöq — … eskirgan bölişi mumkin") }
    if (data == null) item { ListPlaceholder(offline) { scope.launch { load() } } }
    else { empty → item { EmptyState(…) }; items → AdminCard … }
  }
}
```
Data is polled with `LaunchedEffect(Unit) { while (true) { load(); delay(N) } }` (10–60 s; only while the screen is open). `ApiResult.Unauthorized` → `app.watcher.signOutLocally()`. Mutations: set `saving`/`busy`, call through `unwrap(…, onMessage)`, reload afterwards (a refusal also means the screen is stale).

## 6. Text — the new Uzbek Latin alphabet (law signed 2026-10-21, in force 2027-04-22)
`O‘→Ö, G‘→Ğ, Sh→Ş, Ch→Ç` (ng and the tutuq sign stay; tutuq is U+2019 `’` because Manrope has no U+02BC). Never the dotless `ı`. Write new texts **directly** in it (örnating, tölov, söm, qönğiroq, haydovçi, tekşiriş). Server texts shown in the app (`src/modules/admin-attention/service.ts`) follow the same rule.
Check after every change: `node scripts/uz-new-alphabet.mjs apps/admin-android/app/src` must print `would change 0 literals`. `--write` fixes (read the diff: it converts English words that contain "ch/sh" inside string literals, so keep English out of literals). Server file: `… src/modules/admin-attention/service.ts --ts` on one file at a time, read the diff.
Tone of text: short, concrete, tells what happens ("Mijozga xabar boradi"), no jargon, errors say what to do next.

## 7. PIN, fingerprint, login (looks only unless the owner asks)
`PinScreen`: create = type twice + Saqlaş, then the fingerprint offer; enter = fingerprint first (when switched on and enrolled), then the PIN, which opens by itself at the saved length (`PinLock.autoSubmit`). A cancelled/failed fingerprint is never a wrong PIN. Do not weaken lockout (`PinLock.lockoutSeconds`, wipe after 10).

## 8. Checks (no emulator, no full build — AGENTS.md)
```
export JAVA_HOME='C:\Program Files\Android\Android Studio\jbr' ANDROID_HOME="$LOCALAPPDATA/Android/Sdk"
apps\customer-miniapp\android\gradlew.bat -p apps\admin-android --offline :app:testReleaseUnitTest
node scripts/uz-new-alphabet.mjs apps/admin-android/app/src
```
Use the **Release** variants (debug dependencies are not cached offline). The first run after a new dependency needs one online run, and installing dependencies needs the owner's yes. A look is "done" only when the owner has seen it on a phone: say plainly which screens were compiled but not seen. Releasing the APK (versionCode / signed build) is the owner's step: the keystore password is typed only by them.

## 9. Before you finish a screen
- [ ] only kit components and theme colours; no hex colours, no hand-set fonts
- [ ] works in dark mode (status colours come from the getters)
- [ ] empty, loading, offline and error states exist and say what to do
- [ ] every money/removal action goes through `ConfirmDialog` with a named confirm button
- [ ] touch targets ≥ 48 dp; amounts use `AmountStyle` + `somText`
- [ ] new texts in the new alphabet, checker prints 0
- [ ] reachable from a tab and, if it is about something that needs attention, deep-linked from the Diqqat card
