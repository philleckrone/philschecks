<#
.SYNOPSIS
  Offline tests of the Phils Custom (cms) Checks plugin through its test host (build tests\TestHost first):
  the bundle's lists, writing and repairing the checks folder, Paratext's own members (reflect
  mode, on the installed Paratext 9), and the window in EN/ES/FR with a fake runner.
  powershell -ExecutionPolicy Bypass -File Phils_Checks\tests\run_tests.ps1
#>
param([string]$ParatextDir = 'C:\Program Files\Paratext 9')
$ErrorActionPreference = 'Stop'
$exe = Join-Path $PSScriptRoot 'TestHost\bin\Release\PhilsChecksTestHost.exe'
$work = Join-Path $env:TEMP ('phils_checks_test_' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory $work | Out-Null
$env:PC_ROOT = Join-Path $work 'checks'
$env:PC_SETTINGS = Join-Path $work 'settings.txt'
$env:PC_RUNLOG = Join-Path $work 'run.log'
$script:fail = 0
function Check($ok, $what) {
  if ($ok) { Write-Host "ok   $what" } else { Write-Host "FAIL $what" -ForegroundColor Red; $script:fail++ }
}

try {
  # -- lists -------------------------------------------------------------------------------
  $en = @(& $exe list en)
  $es = @(& $exe list es)
  $fr = @(& $exe list fr)
  Check ($en.Count -eq 19) "19 checks in English ($($en.Count))"
  Check ($es.Count -eq 19) "19 checks in Spanish ($($es.Count))"
  Check ($fr.Count -eq 19) "19 checks in French ($($fr.Count))"
  Check (@($en | ? { $_ -match "`t(es|fr)`t" }).Count -eq 0) 'the English list uses only en files'
  # 1.6: every check exists in Spanish and French, so nothing is English only any more.
  Check (@($es | ? { $_ -notmatch "^\S+`tes`t" }).Count -eq 0) 'every Spanish check runs from es/'
  Check (@($fr | ? { $_ -notmatch "^\S+`tfr`t" }).Count -eq 0) 'every French check runs from fr/'
  foreach ($pair in @(@($en, 'en-US', 'English'), @($es, 'es-ES', 'Spanish'), @($fr, 'fr-FR', 'French'))) {
    $names = @($pair[0] | % { ($_ -split "`t")[6] })
    $sorted = [string[]]$names.Clone()
    [Array]::Sort($sorted, [StringComparer]::Create((New-Object Globalization.CultureInfo $pair[1]), $true))
    Check (($sorted -join '|') -eq ($names -join '|')) "the $($pair[2]) list is in alphabetical order (first: $($names[0]))"
  }
  $allReports = $es | ? { $_ -like 'all_reports*' }
  Check ($allReports -match "`tes`t" -and $allReports -notmatch 'english-only') 'All Reports is listed in Spanish'
  Check (($es | ? { $_ -like 'marker_space*' }) -match 'MarkerSpace_sp.cms') 'Marker Space uses its Spanish .cms'
  Check (($fr | ? { $_ -like 'marker_space*' }) -match 'MarkerSpace_fr.cms') 'Marker Space uses its French .cms'
  # Every check with English help has its own Spanish and French help (1.6).
  $esHelp = @{}; foreach ($l in $es) { $f = $l -split "`t"; $esHelp[$f[0]] = $f[3] }
  $frHelp = @{}; foreach ($l in $fr) { $f = $l -split "`t"; $frHelp[$f[0]] = $f[3] }
  Check ($esHelp['quotation_examiner'] -eq 'es/quotation_examiner_sp.rtf' -and $esHelp['short_v_1'] -eq 'es/Short_V_1_sp.rtf') "Spanish checks have Spanish help ($($esHelp['quotation_examiner']))"
  Check (@($fr | ? { ($_ -split "`t")[3] -like 'en/*' }).Count -eq 0) 'no French check falls back to English help'
  Check ($frHelp['marker_space'] -eq 'fr/MarkerSpace_fr.rtf') "French help ($($frHelp['marker_space']))"
  Check ($esHelp['project_BT_reference_tool'] -eq 'es/' -and $frHelp['project_BT_reference_tool'] -eq 'fr/') "a check with no help in any language has none"
  Check (($en | ? { $_ -like 'quotation_matcher*' }) -match "`tchanges`t") 'quotation_matcher is marked as changing text'
  Check ((@($en | ? { $_ -match "`tchanges`t" } | % { ($_ -split "`t")[0] } | Sort-Object) -join ',') -eq 'compare_copy_figures,quotation_matcher') 'only quotation_matcher and compare_copy_figures change text'

  # -- prepare and repair ------------------------------------------------------------------
  $out = @(& $exe prepare en)
  $dir = $out[0]
  $count = @(Get-ChildItem $dir -File).Count
  Check ((Test-Path (Join-Path $dir 'All_Reports.py')) -and (Test-Path (Join-Path $dir 'ptx_goto.py')) -and
         (Test-Path (Join-Path $dir 'ParatextGoTo.exe'))) 'en folder has All_Reports.py, ptx_goto.py and ParatextGoTo.exe'
  $py = Join-Path $dir 'Find_Titles.py'
  $hash = (Get-FileHash $py).Hash
  Add-Content $py "`nimport os  # planted"
  Set-Content (Join-Path $dir 'string.py') 'planted = 1'
  New-Item -ItemType Directory (Join-Path $dir 'pkg') | Out-Null
  Set-Content (Join-Path $dir 'pkg\__init__.py') 'planted = 1'
  & $exe prepare en | Out-Null
  Check ((Get-FileHash $py).Hash -eq $hash) 'a changed .py is written again'
  Check (-not (Test-Path (Join-Path $dir 'string.py'))) 'a planted .py is removed'
  Check (-not (Test-Path (Join-Path $dir 'pkg'))) 'a planted package folder is removed'
  Check (@(Get-ChildItem $dir -File).Count -eq $count) "the folder holds the same $count files"
  $esDir = @(& $exe prepare es)[0]
  Check ((Test-Path (Join-Path $esDir 'MarkerSpace_sp.cms')) -and -not (Test-Path (Join-Path $esDir 'MarkerSpace.cms'))) 'es folder holds the Spanish files only'
  $frDir = @(& $exe prepare fr)[0]
  Check ((Test-Path (Join-Path $frDir 'MarkerSpace_fr.cms')) -and (Test-Path (Join-Path $frDir 'ptx_goto.py')) -and
         -not (Test-Path (Join-Path $frDir 'MarkerSpace.cms'))) 'fr folder holds the French files (and ptx_goto) only'

  # -- Paratext's members ------------------------------------------------------------------
  $env:PC_INIT = Join-Path $work 'projects'
  Push-Location $ParatextDir
  try { $reflect = @(& $exe reflect $ParatextDir) } finally { Pop-Location }
  Remove-Item Env:PC_INIT
  $reflect | ? { $_ -notmatch '^ok   (en|es|fr) ' } | % { Write-Host "     $_" }
  $nCms = @($reflect | ? { $_ -match '^ok   (en|es|fr) ' }).Count
  Check ($reflect[-1] -eq 'PASS') "reflect: $nCms .cms through Paratext's CreateItem, handler swap, search paths"

  # -- the window --------------------------------------------------------------------------
  Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
  # Selects list rows in the test host's process (shared with the installer's UI test).
  Add-Type -Path (Join-Path $PSScriptRoot '..\..\Installer\tests\lvtext.cs')
  Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class PcWin {
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, int msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, int msg, IntPtr w, IntPtr l);
}
'@
  $LVM_GETITEMCOUNT = 0x1004; $BM_CLICK = 0x00F5
  $titles = @{ en = 'Phils Custom (cms) Checks'; es = 'Verificaciones personalizadas (cms) de Phil'; fr = ([string][char]0x56 + [char]0xE9 + 'rifications personnalis' + [char]0xE9 + 'es (cms) de Phil') }
  $helps = @{ en = 'Help'; es = 'Ayuda'; fr = 'Aide' }
  $runs = @{ en ='Run...'; es = 'Ejecutar...'; fr = ('Ex' + [char]0xE9 + 'cuter...') }
  foreach ($lang in 'en', 'es', 'fr') {
    Remove-Item $env:PC_SETTINGS, $env:PC_RUNLOG -ErrorAction SilentlyContinue
    $p = Start-Process $exe -ArgumentList 'form', '--lang', $lang -PassThru
    try {
      $win = $null
      for ($i = 0; $i -lt 50 -and -not $win; $i++) {
        Start-Sleep -Milliseconds 200
        $p.Refresh()
        # The test host is a console exe: wait for the form, not the console window.
        if ($p.MainWindowHandle -ne 0 -and $p.MainWindowTitle -like "$($titles[$lang]) *") { $win = [Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle) }
      }
      Check ($win -and $win.Current.Name -like "$($titles[$lang]) *") "$lang window opens: $($win.Current.Name)"
      # WinForms controls reach UI Automation as panes: the list is found by its window class.
      $list = $win.FindAll('Descendants', [Windows.Automation.Condition]::TrueCondition) | ? { $_.Current.ClassName -like '*SysListView32*' } | Select-Object -First 1
      $n = [int][PcWin]::SendMessage([IntPtr]$list.Current.NativeWindowHandle, $LVM_GETITEMCOUNT, [IntPtr]::Zero, [IntPtr]::Zero)
      Check ($n -eq 19) "$lang window lists 19 checks"
      $run = $win.FindFirst('Descendants', (New-Object Windows.Automation.PropertyCondition ([Windows.Automation.AutomationElement]::NameProperty), $runs[$lang]))
      [PcWin]::PostMessage([IntPtr]$run.Current.NativeWindowHandle, $BM_CLICK, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
      for ($i = 0; $i -lt 25 -and -not (Test-Path $env:PC_RUNLOG); $i++) { Start-Sleep -Milliseconds 200 }
      $log = if (Test-Path $env:PC_RUNLOG) { Get-Content $env:PC_RUNLOG } else { '' }
      $wantLang = $lang
      # The list is sorted by name: the first row is the first line of the test host's list.
      $firstRow = @(& $exe list $wantLang)[0] -split "`t"
      Check ($log -like "RUN $($firstRow[0]) $($firstRow[1]) $($firstRow[2]) *") "$lang Run runs the first check ($($firstRow[0])) from its $($firstRow[1]) folder: $log"

      # 1.5: Help shows the .rtf in the plugin's own viewer (no WordPad on Windows 11 24H2+).
      # The first check may have no help: move down the list to the first one that has.
      $rows = @(& $exe list $wantLang)
      $k = 0; while ($k -lt $rows.Count -and ($rows[$k] -split "`t")[3] -like '*/') { $k++ }
      $firstRow = $rows[$k] -split "`t"
      [LvText]::Select([IntPtr]$list.Current.NativeWindowHandle, $k)
      Start-Sleep -Milliseconds 200
      if ($firstRow[3] -notlike '*/') {
        $help = $win.FindFirst('Descendants', (New-Object Windows.Automation.PropertyCondition ([Windows.Automation.AutomationElement]::NameProperty), $helps[$lang]))
        [PcWin]::PostMessage([IntPtr]$help.Current.NativeWindowHandle, $BM_CLICK, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
        $viewerTitle = "$($firstRow[6]) - $($helps[$lang])"
        $procCond = New-Object Windows.Automation.PropertyCondition ([Windows.Automation.AutomationElement]::ProcessIdProperty), $p.Id
        $viewer = $null
        for ($i = 0; $i -lt 25 -and -not $viewer; $i++) {
          Start-Sleep -Milliseconds 200
          # The viewer is owned by the window, and UI Automation lists it under its owner.
          $viewer = @([Windows.Automation.AutomationElement]::RootElement.FindAll('Children', $procCond)) + @($win.FindAll('Children', [Windows.Automation.Condition]::TrueCondition)) |
            ? { $_.Current.Name -eq $viewerTitle } | Select-Object -First 1
        }
        $rich = if ($viewer) { $viewer.FindAll('Descendants', [Windows.Automation.Condition]::TrueCondition) | ? { $_.Current.ClassName -like '*RICHEDIT50W*' } | Select-Object -First 1 }
        $len = if ($rich) { [int][PcWin]::SendMessage([IntPtr]$rich.Current.NativeWindowHandle, 0x000E, [IntPtr]::Zero, [IntPtr]::Zero) } else { 0 }
        Check ($viewer -and $len -gt 200) "$lang Help opens '$viewerTitle' in the viewer (RichEdit 5, $len characters)"
      }
    } finally {
      if (-not $p.HasExited) { $p.Kill() }
    }
  }
} finally {
  Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}
if ($script:fail) { Write-Host "$($script:fail) failure(s)" -ForegroundColor Red; exit 1 }
Write-Host 'All tests passed.'
