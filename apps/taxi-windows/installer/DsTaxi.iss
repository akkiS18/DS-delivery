; DS Taxi - Windows installer (Inno Setup 6).
; Build with scripts\build-installer.ps1 (it publishes the program first). Do not run ISCC on this file before `publish\` exists.
;
; The program is published SELF-CONTAINED: .NET and WPF are inside the publish folder, so the installer needs no internet,
; no .NET runtime and no other download on the operator's PC (Windows 10 1607 or newer, 64-bit).
; Everything in this file is plain ASCII on purpose (Inno reads scripts without a BOM as ANSI).

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#define AppName "DS Taxi"
#define AppExe "DsTaxi.exe"

[Setup]
; Never change AppId: it is how an upgrade finds the earlier install.
AppId={{7C3A5E52-9B1D-4F0E-8A63-2D5B7E1C94A8}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=DS Delivery
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
; Per-user install: no administrator password is needed on the operator's PC (the program only writes to its own folder and HKCU).
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.14393
OutputDir=..\dist
OutputBaseFilename=DsTaxi-Setup-{#AppVersion}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName={#AppName}
UninstallDisplayIcon={app}\{#AppExe}
; The program hides in the tray when its window is closed, so Restart Manager cannot close it politely; [Code] ends it instead.
CloseApplications=no
RestartApplications=no
; Signing (when the owner has a certificate): add  SignTool=signtool  and define the tool in the IDE / ISCC command line.

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Messages]
ButtonNext=&Keyingisi >
ButtonBack=< &Orqaga
ButtonCancel=Bekor qilish
ButtonInstall=&O'rnatish
ButtonFinish=&Tugatish
WelcomeLabel1=DS Taxi o'rnatuvchisiga xush kelibsiz
WelcomeLabel2=[name/ver] dasturi kompyuteringizga o'rnatiladi. Qo'shimcha hech narsa yuklab olinmaydi.%n%nDavom etish uchun "Keyingisi" tugmasini bosing.
FinishedHeadingLabel=O'rnatish tugadi
FinishedLabelNoIcons=[name] o'rnatildi.
FinishedLabel=[name] o'rnatildi. Dasturni hozir ishga tushirish uchun pastdagi katakchani qoldiring.

[CustomMessages]
english.AutostartTask=Windows bilan birga ishga tushsin (tavsiya etiladi: so'rovlar doim eshitiladi)
english.LaunchProgram=DS Taxi dasturini ishga tushirish
english.AskDeleteData=Saqlangan kirish va sozlamalar ham o'chirilsinmi?%n(Bu kompyuterda keyin qayta kirish kerak bo'ladi.)

[Tasks]
Name: "autostart"; Description: "{cm:AutostartTask}"; GroupDescription: "Qo'shimcha:"
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "Qo'shimcha:"

[Files]
; Everything dotnet publish produced: the program, the .NET runtime, WPF, and Resources\new_order.mp3 (the ringtone).
Source: "..\publish\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{group}\{#AppName} - o'chirish"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Registry]
; The same value the program's own "Windows bilan birga ishga tushsin" switch writes (HKCU Run, value DsTaxi).
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "DsTaxi"; ValueData: """{app}\{#AppExe}"" --minimized"; Flags: uninsdeletevalue; Tasks: autostart

[Run]
Filename: "{app}\{#AppExe}"; Description: "{cm:LaunchProgram}"; Flags: nowait postinstall skipifsilent

[Code]
// End a running copy (it sits in the tray) before files are replaced or removed.
procedure StopRunningProgram;
var
  ResultCode: Integer;
begin
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /IM {#AppExe}', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  StopRunningProgram;
  Result := '';
end;

function InitializeUninstall(): Boolean;
begin
  StopRunningProgram;
  Result := True;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if (CurUninstallStep = usPostUninstall) and (not UninstallSilent) then
  begin
    // %LOCALAPPDATA%\DsTaxi holds only the encrypted sign-in, settings and logs.
    if MsgBox(ExpandConstant('{cm:AskDeleteData}'), mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
      DelTree(ExpandConstant('{localappdata}\DsTaxi'), True, True, True);
  end;
end;
