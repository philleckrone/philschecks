// AutoCorrect Editor backend (built into Phils Checks; tools/build.py wraps it in its own scope).
// It only opens the window: the window reads and writes the project's autocorrect.txt itself,
// through the project folder the user chooses (Paratext 10 does not let extensions read files),
// with ACCore built into the window. Nothing here reads or writes the project.
/* global PCTools, AC_WINDOW_HTML, AC_STRINGS */
const AutoCorrectTool = PCTools.backend({
  id: 'autoCorrect',
  webViewType: 'philsChecks.autoCorrect',
  version: AC_STRINGS.version,
  strings: AC_STRINGS,
  html: AC_WINDOW_HTML,
  size: { width: 1000, height: 820 },
  async scan() {
    return {};
  },
  async apply() {
    return {};
  },
});

return AutoCorrectTool;
