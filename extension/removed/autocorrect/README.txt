The AutoCorrect Editor tool, taken out of Phils Checks in 0.8.0 (2026-11-13) because Paratext 10
does not use autocorrect.txt yet. To bring it back: move src-tools-autocorrect to src\tools\autocorrect
and autocorrect_oracle to tests\, and restore the 'autocorrect' entries in tools\build.py (TOOLS,
WINDOW_CORE), tools\extract_cs_strings.py (XAML_TOOLS), src\main.js, tests\run_tool.js ('ac
roundtrip'), tests\compare_tools.py ('ac') and tests\mock_host.js. Version 0.7.2 still has them all.
