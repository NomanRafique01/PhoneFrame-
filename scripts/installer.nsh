!macro customInstall
  DetailPrint "Configuring Windows Firewall rules for ADB..."
  nsExec::Exec 'netsh advfirewall firewall add rule name="PhoneFrame ADB" dir=in action=allow program="$INSTDIR\resources\assets\platform-tools\adb.exe" enable=yes profile=any'
  Pop $0

  ; Invalidate and refresh Windows Shell icon cache so desktop, Start Menu,
  ; and taskbar reflect the new PhoneFrame icon immediately without logging out.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  ; The ADB server is started from this install folder and keeps adb.exe
  ; running after the app closes, so the uninstaller cannot delete the file
  ; until the daemon is stopped. Doing it here is what lets $INSTDIR go away.
  nsExec::Exec '"$INSTDIR\resources\assets\platform-tools\adb.exe" kill-server'
  Pop $0
  nsExec::Exec 'taskkill /F /IM adb.exe /T'
  Pop $0

  nsExec::Exec 'netsh advfirewall firewall delete rule name="PhoneFrame ADB"'
  Pop $0

  ; Runtime artifacts (caches, logs) are not in the installer's file list and
  ; would otherwise leave the program folder behind on disk.
  RMDir /r "$INSTDIR"

  ; Renderer settings and window state. The folder name follows app.getName(),
  ; so clear both spellings used across builds.
  RMDir /r "$APPDATA\phoneframe"
  RMDir /r "$APPDATA\PhoneFrame"
  RMDir /r "$LOCALAPPDATA\phoneframe"
  RMDir /r "$LOCALAPPDATA\PhoneFrame"

  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
