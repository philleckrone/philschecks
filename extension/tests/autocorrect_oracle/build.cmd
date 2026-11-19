@echo off
rem Builds AutoCorrectOracle.exe from the editor's own sources (no Visual Studio needed).
set SRC=%~dp0..\..\..\..\AutoCorrect\AutoCorrectEditor
"%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /out:"%~dp0AutoCorrectOracle.exe" "%~dp0Program.cs" "%SRC%\Models\AutoCorrectEntry.cs" "%SRC%\Services\AutoCorrectFileService.cs"
