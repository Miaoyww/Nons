!macro NSIS_HOOK_PREUNINSTALL
  ; Preserve the user's choice during an in-place update.
  ${If} $UpdateMode != 1
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "NonsPlayer"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "NonsPlayer"
  ${EndIf}
!macroend
