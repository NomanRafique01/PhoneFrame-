!macro customInstall
  DetailPrint "Configuring Windows Firewall rules for ADB..."
  nsExec::Exec 'netsh advfirewall firewall add rule name="PhoneFrame ADB" dir=in action=allow program="$INSTDIR\resources\assets\platform-tools\adb.exe" enable=yes profile=any'
  Pop $0
!macroend

!macro customUnInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="PhoneFrame ADB"'
  Pop $0
!macroend
