' Zero-Console Native Desktop Launcher for Claude API Explorer
' Double-click this file anytime to open the application window directly without a terminal!
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
appDir = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = appDir

packagedExe = appDir & "\dist\Claude API Explorer-win32-x64\Claude API Explorer.exe"
electronCmd = appDir & "\node_modules\electron\dist\electron.exe"

If fso.FileExists(packagedExe) Then
  shell.Run """" & packagedExe & """", 1, False
ElseIf fso.FileExists(electronCmd) Then
  shell.Run """" & electronCmd & """ .", 0, False
Else
  shell.Run "cmd /c npm start", 0, False
End If
