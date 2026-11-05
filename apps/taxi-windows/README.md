# DS Taxi — Windows (operator program)

The taxi company's desk program: the same functions as the phone app `apps/taxi-android`, laid out for a PC.
Plan and decisions: `docs/PLAN_TAXI_WINDOWS.md`.

- .NET 8, WPF (+ WinForms `NotifyIcon` for the tray), hand-written MVVM, no database.
- `src/DsTaxi.Core` — server calls, alarm/attention logic, formatting (no UI, fully testable).
- `src/DsTaxi.App` — windows, tray, sound, autostart, DPAPI-protected sign-in.
- `tests/DsTaxi.Core.Tests` — xunit tests for the above (no network, no real clock).

## Status

Written without a .NET SDK on the build machine: **not yet compiled or run**. First step on a PC with the SDK:
`dotnet build` and fix whatever the compiler finds, then `dotnet test`, then try it against staging.

## Commands (run from the repository root)

```powershell
winget install Microsoft.DotNet.SDK.8            # once, if `dotnet --version` is missing
dotnet test apps\taxi-windows\DsTaxi.sln          # unit tests
dotnet run --project apps\taxi-windows\src\DsTaxi.App
dotnet publish apps\taxi-windows\src\DsTaxi.App -c Release -r win-x64 --self-contained -o apps\taxi-windows\publish
```

## Installer (Inno Setup)

```powershell
winget install Microsoft.DotNet.SDK.8
winget install JRSoftware.InnoSetup
powershell -ExecutionPolicy Bypass -File apps\taxi-windows\scripts\build-installer.ps1 -Version 1.0.0
```

Result: `apps\taxi-windows\dist\DsTaxi-Setup-1.0.0.exe`. The program is published self-contained, so the installer carries .NET and WPF;
the operator's PC needs no internet and no runtime (Windows 10 1607+ 64-bit). Per-user install (no admin password), start-menu and optional
desktop icon, optional autostart, upgrade-in-place (same AppId), uninstall asks whether to delete the saved sign-in.
The build PC needs internet once (NuGet fetches the runtime pack) and Inno Setup 6.3+. Not code-signed: SmartScreen may warn on first run.

`publish\DsTaxi.exe` is the program (copy the whole folder; it includes `Resources\new_order.mp3`, the ringtone).
Start it with `--minimized` to begin hidden in the tray (this is what the "Windows bilan ishga tushsin" setting registers).

## Logo and title bar

The logo is the phone app's launcher icon: `scripts\make-icon.ps1` draws it into `src\DsTaxi.App\Resources\app.ico` / `logo.png`
(run once, results are committed; the tray icon draws the same shapes in `TrayService.cs`). The window's title bar is painted in the app's
dark colour with the Windows DWM (`TitleBar` in `Services\Native.cs`): exact colour on Windows 11, the dark title bar on Windows 10;
the system minimise / maximise / close buttons stay and turn white.

## Where it keeps things

`%LOCALAPPDATA%\DsTaxi\` — `session.bin` (token, encrypted with Windows DPAPI for this user), `settings.json`
(server, duty, tray, company name, last login), `logs\ds-taxi-YYYYMMDD.log` (14 days; no tokens, passwords, phones or addresses).
Requests are never stored on disk. The password is never stored.

## Server

Fixed at `https://api.sultonxoja.uz`; there is no server field on any screen. A developer can point it elsewhere by editing `ServerUrl` in
`settings.json` (HTTPS only, except localhost).
API: `/api/v1/taxi` (login, requests poll every 3 s — 2 s while ringing —, action). The poll is also the "company is online" signal
for the administrators, so the program keeps polling while its window is hidden in the tray.

## Keys

`Enter` — the main (yellow) step of the selected request, unless it needs a confirmation; `F9` or `Ctrl+M` — silence the sound for 30 s;
`F5` — refresh; `Up`/`Down` — choose a request.

## Program versions (forcing an update)

The program asks the public `GET /api/v1/taxi/client-config` before sign-in and every 30 minutes. The server answers from its environment
(restart after changing): `TAXI_WINDOWS_MIN_VERSION=1.2.0` (older programs stop and show "Dastur yangilanishi kerak"),
`TAXI_WINDOWS_LATEST_VERSION=1.3.0` (older programs show a hint), `TAXI_WINDOWS_DOWNLOAD_URL=https://...` (the installer or its page).
Unset or malformed values mean no rule. Updating itself is manual: the operator downloads and runs the new installer (it replaces the old one).

## How the screen behaves

- A new request that needs an answer never moves the list, the selection or the tab: it waits at the end of the list and a card pinned at the top
  (F2, or click) opens it. The x on the card hides it.
- `Enter` on the main button asks first ("Qabul qilasizmi?"); hard-to-undo questions (Taksi yo'q, Yetkazildi) default to "No".
- Connection lost for 30 s while on duty: a warning sound every minute and one balloon.
- "Ixcham" (top right): a narrow window that stays on top of other programs.

## Not done yet

- Not compiled/tested (see Status). No installer yet (Inno Setup script is planned); code-signing certificate is an owner decision.
- No detection of a muted sound device (only "no output device" is detected); use "Ovozni sinash".
- No spoken (TTS) announcement; no `tel:` call button (phone numbers are copyable).
- Uzbek (Latin) only: no Russian (server messages are Uzbek too; needs a translator's review). No automated UI tests (only the logic in `DsTaxi.Core` is tested).
