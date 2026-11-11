using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Windows.Forms;
using PhilsChecks;

namespace PhilsChecksTests
{
    /// <summary>
    /// Test host for the Phils Custom (cms) Checks plugin (never deployed). Modes:
    ///   list en|es                 the checks of the bundle in that language
    ///   prepare en|es              writes that language's folder (PC_ROOT) and prints it
    ///   reflect [PARATEXT_DIR]     loads Paratext.exe (outside Paratext) and checks every member the
    ///                              plugin uses: each bundled .cms through CMSManager.CreateItem, the
    ///                              OK-button swap on PythonChecksForm, the runner's search paths
    ///   form [--lang L] [--project NAME]   the window, with a fake runner that logs to PC_RUNLOG
    /// PC_ROOT replaces %LOCALAPPDATA%\PhilsChecks\checks, PC_SETTINGS the settings file.
    /// </summary>
    internal static class Program
    {
        [STAThread]
        private static int Main(string[] args)
        {
            try
            {
                if (args.Length == 0) return Usage();
                switch (args[0])
                {
                    case "list": return List(Lang(args, 1));
                    case "prepare": return Prepare(Lang(args, 1));
                    case "reflect": return Reflect(args.Length > 1 ? args[1] : @"C:\Program Files\Paratext 9");
                    case "form": return ShowForm(args);
                    default: return Usage();
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("ERROR: " + ex);
                return 2;
            }
        }

        private static int Usage()
        {
            Console.Error.WriteLine("PhilsChecksTestHost list|prepare en|es, reflect [PARATEXT_DIR], form [--lang L] [--project NAME]");
            return 1;
        }

        private static string Lang(string[] args, int i)
        {
            string lang = args.Length > i ? args[i] : "en";
            if (!CheckBundle.Languages.Contains(lang)) throw new ArgumentException("language must be en or es");
            return lang;
        }

        private static CheckBundle Bundle()
        {
            string zip = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "checks.zip");
            using (Stream s = File.OpenRead(zip))
                return new CheckBundle(s, CheckBundle.DefaultRoot());
        }

        private static int List(string lang)
        {
            foreach (CheckInfo c in Bundle().Checks(lang))
                Console.WriteLine(string.Join("\t", c.Id, c.Lang, c.CmsFile, c.HelpLang + "/" + c.HelpFile,
                    c.ChangesText ? "changes" : "report", c.EnglishOnly ? "english-only" : "", c.Name));
            return 0;
        }

        private static int Prepare(string lang)
        {
            string dir = Bundle().Prepare(lang);
            Console.WriteLine(dir);
            Console.WriteLine(Directory.GetFiles(dir).Length + " files");
            return 0;
        }

        // ------------------------------------------------------------ reflect

        private static int Reflect(string paratextDir)
        {
            AppDomain.CurrentDomain.AssemblyResolve += (s, e) =>
            {
                string p = Path.Combine(paratextDir, new AssemblyName(e.Name).Name + ".dll");
                return File.Exists(p) ? Assembly.LoadFrom(p) : null;
            };
            Assembly.LoadFrom(Path.Combine(paratextDir, "Paratext.exe"));

            // PC_INIT = a scratch projects folder: ParatextData is set up on it, so the runner has
            // a cms folder (ScrTextCollection.CMSDirectory) and its constructor can be tested.
            string init = Environment.GetEnvironmentVariable("PC_INIT");
            if (!string.IsNullOrEmpty(init))
            {
                Directory.CreateDirectory(init);
                Type data = Assembly.LoadFrom(Path.Combine(paratextDir, "ParatextData.dll")).GetType("Paratext.Data.ParatextData", true);
                data.GetMethod("Initialize", new[] { typeof(string), typeof(bool) }).Invoke(null, new object[] { init, false });
                Console.WriteLine("ok   ParatextData set up on " + init);
            }

            string problem;
            ParatextCms cms = ParatextCms.Load(out problem);
            if (cms == null)
            {
                Console.WriteLine("FAIL load: " + problem);
                return 1;
            }
            Console.WriteLine("ok   every member found");

            int failures = 0;
            CheckBundle bundle = Bundle();
            object anyItem = null;
            string anyFolder = null;
            foreach (string lang in CheckBundle.Languages)
            {
                string folder = bundle.Prepare(lang);
                foreach (CheckInfo c in bundle.Checks(lang).Where(c => c.Lang == lang))
                {
                    try
                    {
                        c.HelpPath = c.HelpFile.Length == 0 ? "" : Path.Combine(bundle.Prepare(c.HelpLang), c.HelpFile);
                        object item = cms.CreateItem(c, folder);
                        string name = (string)Get(item, "CheckName");
                        string script = (string)Get(item, "ScriptFileName");
                        bool output = (bool)Get(item, "OutputToProject");
                        string help = (string)Get(item, "HelpFileName");
                        var errors = new List<string>();
                        if (name != c.Name) errors.Add("name '" + name + "' vs '" + c.Name + "'");
                        // Paratext's ValidateUserPermissions reads Path.Combine(cms folder, ScriptFileName):
                        // it must come out as the plugin's own copy.
                        string asParatextSees = string.IsNullOrEmpty(script) ? "" : Path.Combine(@"C:\no\cms", script);
                        if (!asParatextSees.StartsWith(folder + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) || !File.Exists(asParatextSees))
                            errors.Add("script '" + script + "' is not the plugin's copy");
                        if (output != c.ChangesText) errors.Add("OutputToProject " + output);
                        if (c.HelpFile.Length > 0 && !File.Exists(help)) errors.Add("help '" + help + "' missing");
                        Console.WriteLine((errors.Count == 0 ? "ok   " : "FAIL ") + lang + " " + c.CmsFile + " -> " + script +
                                          (errors.Count > 0 ? ": " + string.Join("; ", errors) : ""));
                        if (errors.Count > 0) failures++;
                        if (anyItem == null)
                        {
                            anyItem = item;
                            anyFolder = folder;
                        }
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine("FAIL " + lang + " " + c.CmsFile + ": " + ex.Message);
                        failures++;
                    }
                }
            }

            // The OK-button swap, on plain buttons wired the way PythonChecksForm wires cmdOK
            // (InitializeComponent: cmdOK.Click += cmdOK_Click; in real Paratext another handler is
            // there too, so other handlers must be kept).
            using (var button = new Button())
            using (var direct = new Button())
            {
                var ran = new List<string>();
                string found;
                button.Click += (s, e) => cmdOK_Click(ran);
                bool refusedLambda = !ParatextCms.SwapClickHandler(button, "cmdOK_Click", (s, e) => ran.Add("ours"), out found);
                direct.Click += (s, e) => ran.Add("other");
                direct.Click += Handler;
                bool swapped = ParatextCms.SwapClickHandler(direct, "Handler", (s, e) => ran.Add("ours"), out found);
                bool second = ParatextCms.SwapClickHandler(direct, "Handler", (s, e) => ran.Add("again"), out found);
                direct.PerformClick();
                bool good = refusedLambda && swapped && !second && ran.SequenceEqual(new[] { "other", "ours" });
                Console.WriteLine((good ? "ok   " : "FAIL ") + "click handler swap: " + string.Join(",", ran) +
                                  " (wrong name refused " + refusedLambda + ", second swap refused " + !second +
                                  ", handlers then: " + found + ")");
                if (!good) failures++;
            }

            try
            {
                using (Form dialog = cms.NewEmptyDialog())
                {
                    cms.ReplaceOkHandler(dialog, anyFolder);
                    Console.WriteLine("ok   OK button handler replaced");
                    string anyHelp = Directory.GetFiles(anyFolder, "*.rtf").First();
                    bool helpSwapped = cms.ReplaceHelpHandler(dialog, "test", anyHelp, new PhilsShared.RtfViewer.Texts());
                    bool helpAgain = cms.ReplaceHelpHandler(dialog, "test", anyHelp, new PhilsShared.RtfViewer.Texts());
                    Console.WriteLine((helpSwapped && !helpAgain ? "ok   " : "FAIL ") + "Help button handler replaced by the viewer (" +
                                      helpSwapped + ", second swap refused " + !helpAgain + ")");
                    if (!helpSwapped || helpAgain) failures++;
                    try
                    {
                        cms.ReplaceOkHandler(dialog, anyFolder);
                        Console.WriteLine("FAIL a second swap was not refused");
                        failures++;
                    }
                    catch (InvalidOperationException)
                    {
                        Console.WriteLine("ok   a second swap is refused (the handler is no longer cmdOK_Click)");
                    }
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine("SKIP dialog (needs Paratext running?): " + ex.Message);
            }

            try
            {
                object runner = cms.NewRunner(anyItem);
                List<string> before = cms.SearchPaths(runner);
                cms.PutFolderFirst(runner, anyFolder);
                List<string> after = cms.SearchPaths(runner);
                bool good = after.Count == before.Count + 1 && after[0] == anyFolder;
                Console.WriteLine((good ? "ok   " : "FAIL ") + "search paths: " + string.Join(" | ", after));
                if (!good) failures++;
            }
            catch (Exception ex)
            {
                Console.WriteLine("SKIP runner (needs Paratext running?): " + ex.Message);
            }

            Console.WriteLine(failures == 0 ? "PASS" : failures + " failure(s)");
            return failures == 0 ? 0 : 1;
        }

        private static void cmdOK_Click(List<string> ran)
        {
            ran.Add("lambda");
        }

        private static void Handler(object sender, EventArgs e)
        {
            throw new InvalidOperationException("the original handler ran");
        }

        private static object Get(object o, string field)
        {
            return o.GetType().GetField(field, BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic).GetValue(o);
        }

        // ------------------------------------------------------------ form

        private sealed class FakeRunner : ICheckRunner
        {
            public void Run(CheckInfo check, string folder, IWin32Window owner)
            {
                string log = Environment.GetEnvironmentVariable("PC_RUNLOG");
                string line = "RUN " + check.Id + " " + check.Lang + " " + check.CmsFile + " " + folder +
                              " files=" + Directory.GetFiles(folder).Length;
                if (!string.IsNullOrEmpty(log)) File.AppendAllText(log, line + Environment.NewLine);
                else MessageBox.Show(owner, line, "Fake runner");
            }
        }

        private static int ShowForm(string[] args)
        {
            string locale = "en";
            string project = "PDT15";
            for (int i = 1; i + 1 < args.Length; i += 2)
            {
                if (args[i] == "--lang") locale = args[i + 1];
                else if (args[i] == "--project") project = args[i + 1];
            }
            Application.EnableVisualStyles();
            var form = new ChecksForm(Bundle(), new FakeRunner(), Strings.For(locale), project);
            string location = Environment.GetEnvironmentVariable("PC_LOCATION");
            if (!string.IsNullOrEmpty(location))
            {
                string[] xy = location.Split(',');
                form.StartPosition = FormStartPosition.Manual;
                form.Location = new System.Drawing.Point(int.Parse(xy[0]), int.Parse(xy[1]));
            }
            Application.Run(form);
            return 0;
        }
    }
}
