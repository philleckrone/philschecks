using System;
using System.Collections;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Windows.Forms;

namespace PhilsChecks
{
    /// <summary>
    /// Runs a .cms check through Paratext's own check runner. The plugin API has no way to run
    /// checks, so this reaches Paratext's classes by reflection (checked in Paratext 9.5.110):
    /// <list type="bullet">
    /// <item>Paratext.ToolsMenu.CMSManager.CreateItem(string) reads a .cms file into a CMSItem.</item>
    /// <item>Paratext.ToolsMenu.PythonChecksForm(CMSItem, ScrText, int book, TextForm) is the window
    /// Paratext shows for a check (books, options, parameters, output project).
    /// TextForm.p6checkItem_Click opens it the same way.</item>
    /// <item>Its OK button (cmdOK_Click) makes a CMSRunner(item) and calls Run(books, p1, p2,
    /// scrText, outputScrText, textForm, null). The runner looks for the script in the cms folder
    /// only (its private field engine, an IronPython ScriptEngine, has the search paths cms folder,
    /// Paratext folder, PythonLib.zip).</item>
    /// </list>
    /// So the OK button's handler is replaced by <see cref="RunFromDialog"/>, which does what
    /// cmdOK_Click does, with the plugin's own folder put first in the search paths.
    /// Everything is looked up once in <see cref="Load"/>; when anything is missing the plugin
    /// runs nothing and says why.
    /// </summary>
    internal sealed class ParatextCms
    {
        private const BindingFlags Inst = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;
        private const BindingFlags Stat = BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic;

        private MethodInfo createItem;
        private FieldInfo itemHelpFile, itemScriptFile, itemPromptForBooks, itemOutputToProject;
        private ConstructorInfo runnerCtor;
        private MethodInfo runnerRun;
        private FieldInfo runnerEngine;
        private ConstructorInfo dialogCtor;
        private FieldInfo dlgOk, dlgScrText, dlgItem, dlgBook, dlgTextForm, dlgSelectedBooks,
            dlgCurrentBook, dlgParam1, dlgParam2, dlgOutput, dlgProgress;
        private FieldInfo dlgHelp;   // optional: Paratext's own Help is kept without it
        private PropertyInfo comboScrText;
        private MethodInfo persistChanges;
        private ConstructorInfo bookSetOfBook;
        private PropertyInfo mainFormCurrent, mainFormWindows, mainFormActive;
        private Type textFormType;
        private FieldInfo textFormScrText;
        private PropertyInfo textFormReference;
        private PropertyInfo cmsDirectory;

        private ParatextCms()
        {
        }

        /// <summary>Finds every member the plugin needs; null (with the reason) when one is missing.</summary>
        public static ParatextCms Load(out string problem)
        {
            problem = null;
            try
            {
                var p = new ParatextCms();
                p.Find();
                return p;
            }
            catch (Exception ex)
            {
                problem = ex.Message;
                return null;
            }
        }

        private void Find()
        {
            Assembly paratext = AppDomain.CurrentDomain.GetAssemblies()
                .FirstOrDefault(a => string.Equals(a.GetName().Name, "Paratext", StringComparison.OrdinalIgnoreCase));
            if (paratext == null) throw new InvalidOperationException("Paratext.exe is not loaded");

            Type manager = Need(paratext.GetType("Paratext.ToolsMenu.CMSManager"), "CMSManager");
            Type item = Need(paratext.GetType("Paratext.ToolsMenu.CMSItem"), "CMSItem");
            Type runner = Need(paratext.GetType("Paratext.ToolsMenu.CMSRunner"), "CMSRunner");
            Type dialog = Need(paratext.GetType("Paratext.ToolsMenu.PythonChecksForm"), "PythonChecksForm");
            Type mainForm = Need(paratext.GetType("Paratext.MainForm"), "MainForm");
            textFormType = Need(paratext.GetType("Paratext.TextForm"), "TextForm");

            createItem = Need(manager.GetMethod("CreateItem", Stat, null, new[] { typeof(string) }, null), "CMSManager.CreateItem");
            itemHelpFile = Field(item, "HelpFileName", typeof(string));
            itemScriptFile = Field(item, "ScriptFileName", typeof(string));
            itemPromptForBooks = Field(item, "PromptForBooks", typeof(bool));
            itemOutputToProject = Field(item, "OutputToProject", typeof(bool));

            runnerCtor = Need(runner.GetConstructor(Inst, null, new[] { item }, null), "CMSRunner(CMSItem)");
            runnerRun = Need(runner.GetMethods(Inst).FirstOrDefault(m => m.Name == "Run" && m.GetParameters().Length == 7), "CMSRunner.Run");
            runnerEngine = Need(runner.GetField("engine", Inst), "CMSRunner.engine");
            ParameterInfo[] run = runnerRun.GetParameters();
            Type bookSet = run[0].ParameterType;
            Type scrText = run[3].ParameterType;
            if (run[1].ParameterType != typeof(string) || run[2].ParameterType != typeof(string) ||
                run[4].ParameterType != scrText || run[5].ParameterType != textFormType)
                throw new InvalidOperationException("CMSRunner.Run has changed");

            dialogCtor = Need(dialog.GetConstructor(Inst, null, new[] { item, scrText, typeof(int), textFormType }, null),
                "PythonChecksForm(CMSItem, ScrText, int, TextForm)");
            dlgOk = Field(dialog, "cmdOK", typeof(Button));
            dlgScrText = Field(dialog, "scrText", scrText);
            dlgItem = Field(dialog, "cmsItem", item);
            dlgBook = Field(dialog, "currentBookNumber", typeof(int));
            dlgTextForm = Field(dialog, "textForm", textFormType);
            dlgSelectedBooks = Field(dialog, "selectedBooks", bookSet);
            dlgCurrentBook = Field(dialog, "rdoCurrentBook", typeof(RadioButton));
            dlgParam1 = Field(dialog, "parameter1TextBox", null);
            dlgParam2 = Field(dialog, "parameter2TextBox", null);
            dlgOutput = Field(dialog, "outputScrTextComboBox", null);
            dlgProgress = Field(dialog, "progressBar", typeof(ProgressBar));
            dlgHelp = dialog.GetField("cmdHelp", Inst);
            if (dlgHelp != null && !typeof(Button).IsAssignableFrom(dlgHelp.FieldType)) dlgHelp = null;
            comboScrText = Need(dlgOutput.FieldType.GetProperty("ScrText", Inst), "ScrTextComboBox.ScrText");
            if (!typeof(Control).IsAssignableFrom(dlgParam1.FieldType) || !typeof(Control).IsAssignableFrom(dlgParam2.FieldType))
                throw new InvalidOperationException("PythonChecksForm parameter boxes have changed");
            // The original handler must be the one replaced (see ShowRunDialog).
            Need(dialog.GetMethod("cmdOK_Click", Inst), "PythonChecksForm.cmdOK_Click");

            persistChanges = Need(scrText.GetMethod("PersistChanges", Inst, null, new[] { typeof(bool) }, null), "ScrText.PersistChanges");
            bookSetOfBook = Need(bookSet.GetConstructor(new[] { typeof(int) }), "BookSet(int)");

            mainFormCurrent = Need(mainForm.GetProperty("Current", Stat), "MainForm.Current");
            mainFormWindows = Need(mainForm.GetProperty("ParatextWindows", Inst), "MainForm.ParatextWindows");
            mainFormActive = mainForm.GetProperty("ActiveWindow", Inst);   // optional
            textFormScrText = Field(textFormType, "loadedScrText", scrText);
            textFormReference = textFormType.GetProperty("Reference", Inst);   // optional

            Type collection = Need(scrText.Assembly.GetType("Paratext.Data.ScrTextCollection"), "ScrTextCollection");
            cmsDirectory = Need(collection.GetProperty("CMSDirectory", Stat), "ScrTextCollection.CMSDirectory");

            Need(typeof(Control).GetField("EventClick", Stat), "Control.EventClick");
            Need(typeof(Component).GetProperty("Events", Inst), "Component.Events");
        }

        private static T Need<T>(T member, string name) where T : class
        {
            if (member == null) throw new InvalidOperationException(name + " not found");
            return member;
        }

        private static FieldInfo Field(Type type, string name, Type fieldType)
        {
            FieldInfo f = type.GetField(name, Inst);
            if (f == null) throw new InvalidOperationException(type.Name + "." + name + " not found");
            if (fieldType != null && !fieldType.IsAssignableFrom(f.FieldType))
                throw new InvalidOperationException(type.Name + "." + name + " has changed");
            return f;
        }

        // ------------------------------------------------------------ running

        /// <summary>The ScrText behind the plugin API's project (ProjectWrapper.scrText).</summary>
        private object ScrTextOf(object project)
        {
            FieldInfo f = project.GetType().GetField("scrText", Inst);
            object scrText = f != null ? f.GetValue(project) : null;
            if (scrText == null || !dlgScrText.FieldType.IsInstanceOfType(scrText))
                throw new InvalidOperationException("the project's ScrText was not found");
            return scrText;
        }

        /// <summary>A runner for the window, bound to one project's ScrText.</summary>
        public ICheckRunner ForProject(object project, PhilsShared.RtfViewer.Texts viewerTexts)
        {
            return new ProjectRunner(this, ScrTextOf(project), viewerTexts);
        }

        private sealed class ProjectRunner : ICheckRunner
        {
            private readonly ParatextCms cms;
            private readonly object scrText;
            private readonly PhilsShared.RtfViewer.Texts viewerTexts;

            public ProjectRunner(ParatextCms cms, object scrText, PhilsShared.RtfViewer.Texts viewerTexts)
            {
                this.cms = cms;
                this.scrText = scrText;
                this.viewerTexts = viewerTexts;
            }

            public void Run(CheckInfo check, string folder, IWin32Window owner)
            {
                cms.Run(check, folder, scrText, owner, viewerTexts);
            }
        }

        /// <summary>
        /// Shows Paratext's window for the check (modal), on the project; OK runs the check from
        /// <paramref name="folder"/> through Paratext's runner.
        /// </summary>
        private void Run(CheckInfo check, string folder, object scrText, IWin32Window owner, PhilsShared.RtfViewer.Texts viewerTexts)
        {
            // checktext.* go to the cms folder: make sure it is there.
            string cms = cmsDirectory.GetValue(null, null) as string;
            if (!string.IsNullOrEmpty(cms)) Directory.CreateDirectory(cms);

            object item = CreateItem(check, folder);
            int book;
            object textForm = FindTextForm(scrText, out book);
            using (var dialog = (Form)CallInner(() => dialogCtor.Invoke(new object[] { item, scrText, book, textForm })))
            {
                ReplaceOkHandler(dialog, folder);
                ReplaceHelpHandler(dialog, check.Name, itemHelpFile.GetValue(item) as string, viewerTexts);
                dialog.ShowDialog(owner);
            }
        }

        /// <summary>Paratext's CMSItem for the check's .cms file in <paramref name="folder"/>.</summary>
        internal object CreateItem(CheckInfo check, string folder)
        {
            object item = CallInner(() => createItem.Invoke(null, new object[] { Path.Combine(folder, check.CmsFile) }));
            if (item == null) throw new InvalidOperationException("the .cms file could not be read");
            // Paratext's Help button opens Path.Combine(cms folder, HelpFileName): a full path wins.
            string help = check.HelpPath;
            if (help == null) help = string.IsNullOrEmpty(check.HelpFile) ? "" : Path.Combine(folder, check.HelpFile);
            itemHelpFile.SetValue(item, help);
            // CMSRunner.ValidateUserPermissions reads the script from Path.Combine(cms folder,
            // ScriptFileName) ("Not found" otherwise, 1.2), so it gets the full path of our copy too.
            // CreatePythonScript only uses its name without extension for the import. Those are the
            // field's only readers in Paratext 9.5.110.
            string script = itemScriptFile.GetValue(item) as string;
            if (string.IsNullOrEmpty(script)) throw new InvalidOperationException("the .cms file names no script");
            if (!Path.IsPathRooted(script)) itemScriptFile.SetValue(item, Path.Combine(folder, script));
            return item;
        }

        /// <summary>Takes cmdOK_Click off the OK button and puts <see cref="RunFromDialog"/> there.</summary>
        internal void ReplaceOkHandler(Form dialog, string folder)
        {
            var ok = (Button)dlgOk.GetValue(dialog);
            string found;
            if (!SwapClickHandler(ok, "cmdOK_Click", delegate { RunFromDialog(dialog, folder); }, out found))
                throw new InvalidOperationException("the OK button of PythonChecksForm has changed (its Click handlers: " + found + ")");
        }

        /// <summary>
        /// Paratext's Help button (cmdHelp_Click) hands the .rtf to Windows and ignores failures, so
        /// on Windows 11 24H2+ without Word nothing happened. It shows our viewer instead (1.5).
        /// Optional: when the button or its handler has changed, Paratext's own Help stays.
        /// </summary>
        internal bool ReplaceHelpHandler(Form dialog, string checkName, string helpPath, PhilsShared.RtfViewer.Texts texts)
        {
            if (dlgHelp == null || string.IsNullOrEmpty(helpPath) || !File.Exists(helpPath)) return false;
            var help = dlgHelp.GetValue(dialog) as Button;
            if (help == null) return false;
            string found;
            return SwapClickHandler(help, "cmdHelp_Click", delegate
            {
                try
                {
                    PhilsShared.RtfViewer.Open(dialog, helpPath, checkName, texts);
                }
                catch (Exception ex)
                {
                    MessageBox.Show(dialog, ex.Message, checkName, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                }
            }, out found);
        }

        /// <summary>
        /// Removes the button's Click handler(s) that are the method <paramref name="expected"/>, adds
        /// <paramref name="replacement"/> and returns true. Other handlers (Paratext can add its own at
        /// run time, beside the designer's cmdOK_Click) are left as they are. Returns false and changes
        /// nothing when no handler is <paramref name="expected"/>; <paramref name="found"/> then lists
        /// the handlers there.
        /// </summary>
        internal static bool SwapClickHandler(Button button, string expected, EventHandler replacement, out string found)
        {
            object key = typeof(Control).GetField("EventClick", Stat).GetValue(null);
            var events = (EventHandlerList)typeof(Component).GetProperty("Events", Inst).GetValue(button, null);
            Delegate handler = events[key];
            Delegate[] list = handler != null ? handler.GetInvocationList() : new Delegate[0];
            found = list.Length == 0 ? "none"
                : string.Join(", ", list.Select(d => (d.Method.DeclaringType != null ? d.Method.DeclaringType.Name + "." : "") + d.Method.Name));
            Delegate[] ours = list.Where(d => d.Method.Name == expected).ToArray();
            if (ours.Length == 0) return false;
            foreach (Delegate d in ours)
                events.RemoveHandler(key, d);
            button.Click += replacement;
            return true;
        }

        /// <summary>What PythonChecksForm.cmdOK_Click does, with <paramref name="folder"/> searched first.</summary>
        private void RunFromDialog(Form dialog, string folder)
        {
            object scrText = dlgScrText.GetValue(dialog);
            object item = dlgItem.GetValue(dialog);
            if (!(bool)persistChanges.Invoke(scrText, new object[] { false })) return;

            object books = null;
            if ((bool)itemPromptForBooks.GetValue(item))
            {
                var current = (RadioButton)dlgCurrentBook.GetValue(dialog);
                books = current.Checked
                    ? bookSetOfBook.Invoke(new object[] { (int)dlgBook.GetValue(dialog) })
                    : dlgSelectedBooks.GetValue(dialog);
            }

            var progress = (ProgressBar)dlgProgress.GetValue(dialog);
            progress.Minimum = 0;
            progress.Maximum = 30;
            progress.Value = 0;
            progress.Visible = true;
            try
            {
                object runner = CallInner(() => runnerCtor.Invoke(new[] { item }));
                PutFolderFirst(runner, folder);
                object output = (bool)itemOutputToProject.GetValue(item)
                    ? comboScrText.GetValue(dlgOutput.GetValue(dialog), null) : null;
                string p1 = ((Control)dlgParam1.GetValue(dialog)).Text;
                string p2 = ((Control)dlgParam2.GetValue(dialog)).Text;
                object textForm = dlgTextForm.GetValue(dialog);
                CallInner(() => runnerRun.Invoke(runner, new[] { books, p1, p2, scrText, output, textForm, null }));
            }
            catch (Exception ex)
            {
                MessageBox.Show(dialog, ex.Message, "Paratext", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
            progress.Visible = false;
            dialog.DialogResult = DialogResult.OK;
        }

        // ------------------------------------------------------------ for the test host

        /// <summary>A CMSRunner for the item (the test host checks its search paths).</summary>
        internal object NewRunner(object item)
        {
            return CallInner(() => runnerCtor.Invoke(new[] { item }));
        }

        /// <summary>The runner's Python search paths, in order.</summary>
        internal List<string> SearchPaths(object runner)
        {
            object engine = runnerEngine.GetValue(runner);
            MethodInfo get = engine.GetType().GetMethod("GetSearchPaths", Type.EmptyTypes);
            return new List<string>(((IEnumerable)get.Invoke(engine, null)).Cast<string>());
        }

        /// <summary>PythonChecksForm's designer-only constructor: its OK button is wired as in the real window.</summary>
        internal Form NewEmptyDialog()
        {
            ConstructorInfo empty = dialogCtor.DeclaringType.GetConstructor(Inst, null, Type.EmptyTypes, null);
            if (empty == null) throw new InvalidOperationException("PythonChecksForm() not found");
            return (Form)CallInner(() => empty.Invoke(null));
        }

        /// <summary>Puts the plugin's folder before the cms folder in the runner's Python search paths.</summary>
        internal void PutFolderFirst(object runner, string folder)
        {
            object engine = runnerEngine.GetValue(runner);
            if (engine == null) throw new InvalidOperationException("the check runner has no Python engine");
            MethodInfo get = engine.GetType().GetMethod("GetSearchPaths", Type.EmptyTypes);
            MethodInfo set = engine.GetType().GetMethods().FirstOrDefault(m => m.Name == "SetSearchPaths" && m.GetParameters().Length == 1);
            if (get == null || set == null) throw new InvalidOperationException("the Python engine's search paths cannot be set");
            var paths = new List<string>(((IEnumerable)get.Invoke(engine, null)).Cast<string>());
            paths.RemoveAll(p => string.Equals(p, folder, StringComparison.OrdinalIgnoreCase));
            paths.Insert(0, folder);
            set.Invoke(engine, new object[] { paths });
        }

        /// <summary>
        /// The project's text window (the active one when it shows the project), as Paratext's own
        /// menu passes it, so the results list goes to that window; and its book (1 without one).
        /// </summary>
        private object FindTextForm(object scrText, out int book)
        {
            book = 1;
            object main = mainFormCurrent.GetValue(null, null);
            if (main == null) return null;
            var candidates = new List<object>();
            if (mainFormActive != null)
            {
                object active = mainFormActive.GetValue(main, null);
                if (active != null) candidates.Add(active);
            }
            var all = mainFormWindows.GetValue(main, null) as IEnumerable;
            if (all != null) candidates.AddRange(all.Cast<object>());

            foreach (object w in candidates)
            {
                if (w == null || !textFormType.IsInstanceOfType(w)) continue;
                if (!ReferenceEquals(textFormScrText.GetValue(w), scrText)) continue;
                book = BookOf(w);
                return w;
            }
            return null;
        }

        private int BookOf(object textForm)
        {
            try
            {
                if (textFormReference == null) return 1;
                object vref = textFormReference.GetValue(textForm, null);
                PropertyInfo bookNum = vref != null ? vref.GetType().GetProperty("BookNum") : null;
                int n = bookNum != null ? (int)bookNum.GetValue(vref, null) : 0;
                return n > 0 ? n : 1;
            }
            catch (Exception)
            {
                return 1;
            }
        }

        /// <summary>Runs a reflection call and gives back the real exception, not TargetInvocationException.</summary>
        private static object CallInner(Func<object> call)
        {
            try
            {
                return call();
            }
            catch (TargetInvocationException ex)
            {
                if (ex.InnerException != null)
                    throw new InvalidOperationException(ex.InnerException.Message, ex.InnerException);
                throw;
            }
        }
    }
}
