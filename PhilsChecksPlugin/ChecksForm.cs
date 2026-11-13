using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Windows.Forms;

namespace PhilsChecks
{
    /// <summary>
    /// The list of checks for one project. Run opens Paratext's own window for the chosen check
    /// (books, options, parameters), which then shows the results as usual. Not modal.
    /// </summary>
    public sealed class ChecksForm : Form
    {
        private readonly CheckBundle bundle;
        private readonly ICheckRunner runner;
        private readonly Strings strings;
        private readonly ComboBox languageBox = new ComboBox();
        private readonly ListView list = new ListView();
        private readonly TextBox description = new TextBox();
        private readonly Label count = new Label();
        private readonly Button runButton = new Button();
        private readonly Button helpButton = new Button();
        private readonly Button closeButton = new Button();
        private List<CheckInfo> checks = new List<CheckInfo>();
        private bool loading = true;

        public ChecksForm(CheckBundle bundle, ICheckRunner runner, Strings strings, string projectName)
        {
            this.bundle = bundle;
            this.runner = runner;
            this.strings = strings;

            Text = strings.Title + " " + Strings.ToolVersion + " - " + projectName;
            Font = new Font(SystemFonts.MessageBoxFont.FontFamily, SystemFonts.MessageBoxFont.SizeInPoints + 1f);
            StartPosition = FormStartPosition.CenterScreen;
            Size = new Size(760, 600);
            MinimumSize = new Size(520, 400);
            ShowInTaskbar = true;

            var table = new TableLayoutPanel();
            table.Dock = DockStyle.Fill;
            table.Padding = new Padding(10);
            table.ColumnCount = 1;
            table.RowCount = 5;
            table.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            table.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            table.RowStyles.Add(new RowStyle(SizeType.Percent, 65f));
            table.RowStyles.Add(new RowStyle(SizeType.Percent, 35f));
            table.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            Controls.Add(table);

            var intro = new Label();
            intro.Text = strings.Intro;
            intro.AutoSize = true;
            intro.MaximumSize = new Size(700, 0);
            intro.Margin = new Padding(3, 0, 3, 8);
            table.Controls.Add(intro, 0, 0);

            var langRow = new FlowLayoutPanel();
            langRow.AutoSize = true;
            langRow.WrapContents = false;
            langRow.Margin = new Padding(0, 0, 0, 6);
            var langLabel = new Label();
            langLabel.Text = strings.ChecksLanguage;
            langLabel.AutoSize = true;
            langLabel.Margin = new Padding(3, 7, 3, 0);
            languageBox.DropDownStyle = ComboBoxStyle.DropDownList;
            languageBox.Items.Add(strings.English);
            languageBox.Items.Add(strings.Spanish);
            languageBox.Items.Add(strings.French_);
            languageBox.Width = 160;
            count.AutoSize = true;
            count.Margin = new Padding(20, 7, 3, 0);
            langRow.Controls.Add(langLabel);
            langRow.Controls.Add(languageBox);
            langRow.Controls.Add(count);
            table.Controls.Add(langRow, 0, 1);

            list.Dock = DockStyle.Fill;
            list.View = View.Details;
            list.FullRowSelect = true;
            list.HideSelection = false;
            list.MultiSelect = false;
            list.HeaderStyle = ColumnHeaderStyle.Nonclickable;
            list.Columns.Add(strings.ColCheck, 480);
            list.Columns.Add(strings.ColKind, 180);
            table.Controls.Add(list, 0, 2);

            description.Dock = DockStyle.Fill;
            description.Multiline = true;
            description.ReadOnly = true;
            description.ScrollBars = ScrollBars.Vertical;
            description.BackColor = SystemColors.Window;
            description.Margin = new Padding(3, 8, 3, 3);
            table.Controls.Add(description, 0, 3);

            var buttons = new FlowLayoutPanel();
            buttons.AutoSize = true;
            buttons.Dock = DockStyle.Fill;
            buttons.FlowDirection = FlowDirection.RightToLeft;
            buttons.Margin = new Padding(0, 8, 0, 0);
            foreach (Button b in new[] { closeButton, helpButton, runButton })
            {
                b.AutoSize = true;
                b.MinimumSize = new Size(100, 0);
                buttons.Controls.Add(b);
            }
            closeButton.Text = strings.CloseButton;
            helpButton.Text = strings.HelpButton;
            runButton.Text = strings.RunButton;
            runButton.Font = new Font(Font, FontStyle.Bold);
            table.Controls.Add(buttons, 0, 4);

            AcceptButton = runButton;
            CancelButton = closeButton;
            closeButton.Click += delegate { Close(); };
            runButton.Click += delegate { RunSelected(); };
            helpButton.Click += delegate { ShowHelp(); };
            list.DoubleClick += delegate { RunSelected(); };
            list.SelectedIndexChanged += delegate { ShowSelected(); };
            languageBox.SelectedIndexChanged += delegate
            {
                string lang = CheckLanguage;
                if (!loading) Settings.SaveLanguage(lang);   // only the user's own choice is kept
                Fill(lang);
            };

            string start = Settings.LoadLanguage()
                ?? (strings.Language == Lang.Spanish ? "es" : strings.Language == Lang.French ? "fr" : "en");
            languageBox.SelectedIndex = Math.Max(0, Array.IndexOf(CheckBundle.Languages, start));   // fills the list
            loading = false;
        }

        /// <summary>The language of the checks shown ("en", "es" or "fr"; in the order of CheckBundle.Languages).</summary>
        public string CheckLanguage
        {
            get { return CheckBundle.Languages[Math.Max(0, languageBox.SelectedIndex)]; }
        }

        private void Fill(string lang)
        {
            string selectedId = Selected != null ? Selected.Id : null;
            checks = bundle.Checks(lang);
            list.BeginUpdate();
            list.Items.Clear();
            foreach (CheckInfo c in checks)
            {
                var item = new ListViewItem(c.EnglishOnly ? c.Name + "  " + strings.EnglishOnly : c.Name);
                item.SubItems.Add(c.ChangesText ? strings.KindChanges : strings.KindReport);
                item.Tag = c;
                list.Items.Add(item);
            }
            list.EndUpdate();
            count.Text = string.Format(strings.Count, checks.Count);
            int index = Math.Max(0, checks.FindIndex(c => c.Id == selectedId));
            if (list.Items.Count > 0)
            {
                list.Items[index].Selected = true;
                list.Items[index].Focused = true;
                list.EnsureVisible(index);
            }
            ShowSelected();
        }

        private CheckInfo Selected
        {
            get { return list.SelectedItems.Count > 0 ? (CheckInfo)list.SelectedItems[0].Tag : null; }
        }

        private void ShowSelected()
        {
            CheckInfo c = Selected;
            description.Text = c != null ? c.Description : "";
            helpButton.Enabled = c != null && c.HelpFile.Length > 0;
            runButton.Enabled = c != null;
        }

        private void RunSelected()
        {
            CheckInfo c = Selected;
            if (c == null)
            {
                MessageBox.Show(this, strings.NoCheckChosen, strings.Title, MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
            string folder;
            try
            {
                folder = bundle.Prepare(c.Lang);
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, string.Format(strings.BundleProblem, bundle.Root, ex.Message), strings.Title,
                    MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            try
            {
                // The help may be the English check's (in en\): prepare that folder too.
                c.HelpPath = c.HelpFile.Length == 0 ? ""
                    : c.HelpLang == c.Lang ? Path.Combine(folder, c.HelpFile)
                    : Path.Combine(bundle.Prepare(c.HelpLang), c.HelpFile);
                runner.Run(c, folder, this);
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, string.Format(strings.Error, ex.Message), strings.Title,
                    MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        private void ShowHelp()
        {
            CheckInfo c = Selected;
            if (c == null || c.HelpFile.Length == 0)
            {
                MessageBox.Show(this, strings.NoHelp, strings.Title, MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
            try
            {
                string path = Path.Combine(bundle.Prepare(c.HelpLang), c.HelpFile);
                // Our own viewer (1.5): Windows 11 24H2+ has no WordPad, so without Word an .rtf
                // may not open at all.
                PhilsShared.RtfViewer.Open(this, path, c.Name + " - " + strings.HelpButton, strings.Viewer());
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, string.Format(strings.Error, ex.Message), strings.Title,
                    MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }
    }

    /// <summary>The user's choice of language for the checks: %APPDATA%\ParatextPhilsChecks\settings.txt.</summary>
    internal static class Settings
    {
        private static string FilePath()
        {
#if PC_TESTHOST
            string over = Environment.GetEnvironmentVariable("PC_SETTINGS");
            if (!string.IsNullOrEmpty(over)) return over;
#endif
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "ParatextPhilsChecks", "settings.txt");
        }

        public static string LoadLanguage()
        {
            try
            {
                string path = FilePath();
                if (!File.Exists(path)) return null;
                foreach (string line in File.ReadAllLines(path))
                    if (line.StartsWith("language="))
                    {
                        string lang = line.Substring(9).Trim();
                        if (CheckBundle.Languages.Contains(lang)) return lang;
                    }
            }
            catch (Exception) { }
            return null;
        }

        public static void SaveLanguage(string lang)
        {
            try
            {
                string path = FilePath();
                Directory.CreateDirectory(Path.GetDirectoryName(path));
                File.WriteAllText(path, "language=" + lang + "\r\n");
            }
            catch (Exception) { }
        }
    }
}
