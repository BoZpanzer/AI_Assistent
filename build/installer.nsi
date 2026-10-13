; JARVIS – Windows installer (NSIS 3, Modern UI 2)
; Per-user installation: no administrator rights needed, data in %APPDATA%\JARVIS stays untouched.
Unicode true
ManifestDPIAware true
SetCompressor /SOLID lzma
SetCompressorDictSize 64

!ifndef VERSION
  !define VERSION "3.0.0"
!endif
!ifndef SRCDIR
  !define SRCDIR "..\release\win-unpacked"
!endif
!ifndef OUTFILE
  !define OUTFILE "..\release\JARVIS_Setup.exe"
!endif

!define APPNAME "JARVIS"
!define COMPANY "BoZ"
!define APPID "de.boz.jarvis"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPID}"

Name "${APPNAME} ${VERSION}"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\JARVIS"
InstallDirRegKey HKCU "Software\${APPID}" "InstallDir"
RequestExecutionLevel user
BrandingText "JARVIS – Personal Intelligence System"

VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=1031 "ProductName" "${APPNAME}"
VIAddVersionKey /LANG=1031 "CompanyName" "${COMPANY}"
VIAddVersionKey /LANG=1031 "FileDescription" "JARVIS Installationsprogramm"
VIAddVersionKey /LANG=1031 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=1031 "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=1031 "LegalCopyright" "© 2026 ${COMPANY}"

!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"
!include "Sections.nsh"

Var Relaunch

!define MUI_ICON "icon.ico"
!define MUI_UNICON "icon.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Willkommen bei JARVIS ${VERSION}"
!define MUI_WELCOMEPAGE_TEXT "Dieser Assistent installiert JARVIS – deinen persönlichen KI-Assistenten für Windows.$\r$\n$\r$\nEs werden keine Administratorrechte und keine weiteren Programme (Python, Node.js) benötigt.$\r$\n$\r$\nDeine persönlichen Daten liegen getrennt unter %APPDATA%\JARVIS und bleiben bei Updates erhalten."
!define MUI_FINISHPAGE_RUN "$INSTDIR\JARVIS.exe"
!define MUI_FINISHPAGE_RUN_TEXT "JARVIS jetzt starten"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "German"


Section "JARVIS (erforderlich)" SecMain
  SectionIn RO
  SetOutPath "$INSTDIR"
  ; Remove the previous program files (never the user data in %APPDATA%\JARVIS)
  RMDir /r "$INSTDIR\resources"
  RMDir /r "$INSTDIR\locales"
  File /r "${SRCDIR}\*.*"
  WriteUninstaller "$INSTDIR\Uninstall JARVIS.exe"

  ; Ein einziger Startmenü-Eintrag (Deinstallieren läuft über Windows → Apps)
  RMDir /r "$SMPROGRAMS\JARVIS"
  Delete "$SMPROGRAMS\JARVIS.lnk"
  CreateShortcut "$SMPROGRAMS\JARVIS.lnk" "$INSTDIR\JARVIS.exe" "" "$INSTDIR\JARVIS.exe" 0

  ; Reste von JARVIS 2.0 (Inno-Setup, gleicher Programmordner) entfernen:
  ; alter Apps-Eintrag, alter Deinstaller und die alte Python-Laufzeit.
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\{36FC88F2-4904-49DC-89F6-7657B85DF3CC}_is1"
  ${If} ${FileExists} "$INSTDIR\unins000.dat"
    Delete "$INSTDIR\unins000.exe"
    Delete "$INSTDIR\unins000.dat"
    Delete "$INSTDIR\unins000.msg"
    RMDir /r "$INSTDIR\_internal"
  ${EndIf}

  WriteRegStr HKCU "Software\${APPID}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTKEY}" "Publisher" "${COMPANY}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayIcon" "$INSTDIR\JARVIS.exe"
  WriteRegStr HKCU "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTKEY}" "UninstallString" '"$INSTDIR\Uninstall JARVIS.exe"'
  WriteRegStr HKCU "${UNINSTKEY}" "QuietUninstallString" '"$INSTDIR\Uninstall JARVIS.exe" /S'
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${UNINSTKEY}" "EstimatedSize" "$0"
SectionEnd

Section "Desktop-Verknüpfung" SecDesktop
  CreateShortcut "$DESKTOP\JARVIS.lnk" "$INSTDIR\JARVIS.exe" "" "$INSTDIR\JARVIS.exe" 0
SectionEnd

Function .onInit
  ; Update aus der App: "JARVIS_Setup.exe /S /RELAUNCH" → danach JARVIS neu starten
  ${GetParameters} $R0
  StrCpy $Relaunch "0"
  ClearErrors
  ${GetOptions} $R0 "/RELAUNCH" $R1
  ${IfNot} ${Errors}
    StrCpy $Relaunch "1"
    ; Beim Update keine Desktop-Verknüpfung neu anlegen, wenn der Nutzer sie gelöscht hat
    ${IfNot} ${FileExists} "$DESKTOP\JARVIS.lnk"
      !insertmacro UnselectSection ${SecDesktop}
    ${EndIf}
  ${EndIf}
  ; Close a running instance so files can be replaced (update case).
  nsExec::Exec 'taskkill /IM JARVIS.exe /F'
  Sleep 1200
FunctionEnd

Function .onInstSuccess
  ${If} $Relaunch == "1"
    Exec '"$INSTDIR\JARVIS.exe" --updated'
  ${EndIf}
FunctionEnd

LangString DESC_Main ${LANG_GERMAN} "Die JARVIS-Anwendung."
LangString DESC_Desktop ${LANG_GERMAN} "Verknüpfung auf dem Desktop anlegen."
!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecMain} $(DESC_Main)
  !insertmacro MUI_DESCRIPTION_TEXT ${SecDesktop} $(DESC_Desktop)
!insertmacro MUI_FUNCTION_DESCRIPTION_END

Function un.onInit
  nsExec::Exec 'taskkill /IM JARVIS.exe /F'
  Sleep 800
FunctionEnd

Section "Uninstall"
  Delete "$DESKTOP\JARVIS.lnk"
  RMDir /r "$SMPROGRAMS\JARVIS"
  Delete "$SMPROGRAMS\JARVIS.lnk"
  ; Autostart entries written by the app (Electron login item)
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${APPID}"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${APPNAME}"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "electron.app.JARVIS"
  DeleteRegKey HKCU "${UNINSTKEY}"
  DeleteRegKey HKCU "Software\${APPID}"
  RMDir /r "$INSTDIR"
  IfSilent keep
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Sollen auch deine persönlichen JARVIS-Daten gelöscht werden?$\r$\n(Aufgaben, Brain, Gespräche, Einstellungen, Sicherungen in %APPDATA%\JARVIS)$\r$\n$\r$\nStandard: Nein – Daten bleiben für eine spätere Neuinstallation erhalten." IDNO keep
    RMDir /r "$APPDATA\JARVIS"
  keep:
SectionEnd
