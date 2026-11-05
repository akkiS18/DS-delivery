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

`publish\DsTaxi.exe` is the program (copy the whole folder; it includes `Resources\new_order.mp3`, the ringtone).
Start it with `--minimized` to begin hidden in the tray (this is what the "Windows bilan ishga tushsin" setting registers).

## Where it keeps things

`%LOCALAPPDATA%\DsTaxi\` — `session.bin` (token, encrypted with Windows DPAPI for this user), `settings.json`
(server, duty, tray, company name, last login), `logs\ds-taxi-YYYYMMDD.log` (14 days; no tokens, passwords, phones or addresses).
Requests are never stored on disk. The password is never stored.

## Server

Default `https://api.sultonxoja.uz`; changeable on the sign-in screen under "Server" (HTTPS only, except localhost for development).
API: `/api/v1/taxi` (login, requests poll every 3 s — 2 s while ringing —, action). The poll is also the "company is online" signal
for the administrators, so the program keeps polling while its window is hidden in the tray.

## Keys

`Enter` — the main (yellow) step of the selected request, unless it needs a confirmation; `F9` or `Ctrl+M` — silence the sound for 30 s;
`F5` — refresh; `Up`/`Down` — choose a request.

## Not done yet

- Not compiled/tested (see Status). No installer yet (Inno Setup script is planned); code-signing certificate is an owner decision.
- No detection of a muted sound device (only "no output device" is detected); use "Ovozni sinash".
- No spoken (TTS) announcement; no `tel:` call button (phone numbers are copyable).
