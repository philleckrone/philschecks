# Phils Custom (cms) Checks

*This page is the English user guide, [PhilsChecks_UserGuide.rtf](plugin/PhilsChecks_UserGuide.rtf). The guide is also available in Spanish ([PhilsChecks_UserGuide_sp.rtf](plugin/PhilsChecks_UserGuide_sp.rtf)) and French ([PhilsChecks_UserGuide_fr.rtf](plugin/PhilsChecks_UserGuide_fr.rtf)).*

## Purpose

Phils Custom (cms) Checks is a Paratext plugin. It lists Phil's custom checks and runs the one you choose. The checks come with the plugin, so nothing has to be copied into the cms folder of the Paratext projects folder.

The checks include, among others:

- Report of TOC, Report of Titles and the section heading report.
- Quotation marks, \q errors, nested styles, marker spaces and footnotes.
- Figure captions, capitals at the start of a verse or in mid-sentence, short verse 1, references without markers.
- All Reports, which runs ten of the reports into one HTML page.
- Quotation Matcher, Compare and Copy Figures, Case Convert and Convert Codes, which can change text.

## Installing

1. Download Install_Phils_tools.exe from the Paratext_Plugins folder. If your browser warns about the file, choose to keep it.

2. Close Paratext.

3. Double-click Install_Phils_tools.exe. If Windows says it protected your PC, click "More info", then "Run anyway" (the installer is not signed yet).

4. Tick Phils Custom (cms) Checks and click "Install / update ticked". It installs into every Paratext 9 on the computer. If Windows asks for permission, click Yes. The same window updates the plugin later (its status then says "Update available") or removes it ("Remove ticked"), and its "User guide" button opens this guide.

## How to use

1. Open the project in a Scripture window and choose Tools > Phils Custom (cms) Checks...

2. Choose the language of the checks: English, Spanish or French. Every check exists in all three languages, and its help (when it has one) is in the same language. Your choice is remembered.

3. Select a check. Its description is shown below the list. Help shows the check's help, when it has one, in a window of its own, so Word is not needed (Paratext's Help button in the check window does the same).

4. Click Run... (or double-click the check). Paratext's own check window opens, as in Paratext's checks menu: choose the books, set the options and click OK.

5. The results appear as usual: in Paratext's list window, and for some checks also in an HTML report.

The "Kind" column says "Changes text" for checks that can change a project. Paratext then asks for the project to write into, and only runs the check if you may edit it.

## Where the checks are kept

Before each run the plugin writes the checks into %LOCALAPPDATA%\PhilsChecks\checks (one folder per language). It compares every file there with the copy inside the plugin, writes again any file that differs and removes any other file, so only the checks that came with the plugin can run.

The checks run through Paratext's own check runner. A check with the same name in your cms folder is not used: the plugin's copy comes first. Paratext's temporary files (checktext.\*) are still written to the cms folder, as for any check.

If Paratext is updated and the plugin can no longer find Paratext's check window, it says so and runs nothing.
