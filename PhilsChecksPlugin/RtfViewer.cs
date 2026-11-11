using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace PhilsShared
{
    /// <summary>
    /// Shows an .rtf help file in a read-only window of our own. Windows 11 24H2 and later no longer
    /// has WordPad, so without Word or LibreOffice Windows cannot open an .rtf at all; the RichEdit
    /// control is part of every Windows. Shared by the Phils Custom (cms) Checks plugin and
    /// Install_Phils_tools (linked into its project). Keep this file ASCII.
    /// </summary>
    public sealed class RtfViewer : Form
    {
        /// <summary>Texts of the window, in the caller's language.</summary>
        public sealed class Texts
        {
            public string OpenElsewhere = "Open in another program";
            public string Close = "Close";
            /// <summary>{0} = the reason.</summary>
            public string CannotOpenElsewhere = "Windows could not open the file in another program: {0}";
        }

        private readonly string path;
        private readonly Texts texts;
        private readonly RichView view;

        private RtfViewer(string path, string title, Texts texts)
        {
            this.path = path;
            this.texts = texts;
            Text = title;
            Font = SystemFonts.MessageBoxFont;
            ShowInTaskbar = true;
            MinimizeBox = true;
            StartPosition = FormStartPosition.CenterParent;
            Rectangle area = Screen.FromPoint(Cursor.Position).WorkingArea;
            Size = new Size(Math.Min(area.Width - 40, 860), Math.Min(area.Height - 40, 760));

            view = new RichView();
            view.Dock = DockStyle.Fill;
            // ReadOnly is set after loading: a read-only RichEdit drops the pictures while loading.
            view.BackColor = SystemColors.Window;
            view.BorderStyle = BorderStyle.None;
            view.DetectUrls = true;
            view.ShortcutsEnabled = true;
            view.LinkClicked += OnLink;

            var holder = new Panel();
            holder.Dock = DockStyle.Fill;
            holder.Padding = new Padding(10, 8, 4, 0);
            holder.BackColor = SystemColors.Window;
            holder.Controls.Add(view);

            var buttons = new FlowLayoutPanel();
            buttons.Dock = DockStyle.Bottom;
            buttons.FlowDirection = FlowDirection.RightToLeft;
            buttons.AutoSize = true;
            buttons.Padding = new Padding(6);
            var close = new Button();
            close.Text = texts.Close;
            close.AutoSize = true;
            close.DialogResult = DialogResult.Cancel;
            close.Click += delegate { Close(); };
            var other = new Button();
            other.Text = texts.OpenElsewhere;
            other.AutoSize = true;
            other.Click += delegate { OpenElsewhere(); };
            buttons.Controls.Add(close);
            buttons.Controls.Add(other);
            CancelButton = close;

            Controls.Add(holder);
            Controls.Add(buttons);
        }

        /// <summary>
        /// Opens <paramref name="path"/> in a new viewer window (not modal), owned by
        /// <paramref name="owner"/> when there is one, so it closes with it. Throws when the file
        /// cannot be read.
        /// </summary>
        public static RtfViewer Open(IWin32Window owner, string path, string title, Texts texts)
        {
            byte[] data = File.ReadAllBytes(path);   // a missing or locked file fails here, before any window
            var v = new RtfViewer(path, title, texts ?? new Texts());
            var ownerForm = owner as Form;
            if (ownerForm == null && owner != null) ownerForm = Control.FromHandle(owner.Handle) as Form;
            if (ownerForm != null)
            {
                v.StartPosition = FormStartPosition.Manual;
                Rectangle area = Screen.FromControl(ownerForm).WorkingArea;
                Rectangle o = ownerForm.Bounds;
                int x = Math.Max(area.Left, Math.Min(o.Left + (o.Width - v.Width) / 2, area.Right - v.Width));
                int y = Math.Max(area.Top, Math.Min(o.Top + (o.Height - v.Height) / 2, area.Bottom - v.Height));
                v.Location = new Point(x, y);
                v.Show(ownerForm);
            }
            else
            {
                v.StartPosition = FormStartPosition.CenterScreen;
                v.Show();
            }
            // Loaded once the window is shown, and only then made read-only: loaded earlier (handle
            // made before it had a parent) or into a read-only control, the pictures were not shown.
            try
            {
                using (var m = new MemoryStream(data))
                    v.view.LoadFile(m, RichTextBoxStreamType.RichText);
            }
            catch
            {
                v.Close();
                throw;
            }
            v.view.ReadOnly = true;
            v.view.SelectionStart = 0;
            v.Activate();
            return v;
        }

        /// <summary>The text shown (for tests).</summary>
        public string ShownText
        {
            get { return view.Text; }
        }

        private void OpenElsewhere()
        {
            try
            {
                Process.Start(path);
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, string.Format(texts.CannotOpenElsewhere, ex.Message), Text,
                    MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
        }

        private static void OnLink(object sender, LinkClickedEventArgs e)
        {
            string link = e.LinkText ?? "";
            if (!link.StartsWith("http://", StringComparison.OrdinalIgnoreCase) &&
                !link.StartsWith("https://", StringComparison.OrdinalIgnoreCase) &&
                !link.StartsWith("mailto:", StringComparison.OrdinalIgnoreCase))
                return;
            try
            {
                Process.Start(link);
            }
            catch (Exception)
            {
                // No browser: nothing more to do.
            }
        }

        /// <summary>
        /// RichEdit 4.1+ (msftedit.dll, class RICHEDIT50W), which shows the PNG pictures in the
        /// guides; .NET Framework may otherwise use the older RichEdit 2.0.
        /// </summary>
        private sealed class RichView : RichTextBox
        {
            [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
            private static extern IntPtr LoadLibrary(string name);

            private static bool? loaded;

            protected override CreateParams CreateParams
            {
                get
                {
                    CreateParams cp = base.CreateParams;
                    if (loaded == null) loaded = LoadLibrary("msftedit.dll") != IntPtr.Zero;
                    if (loaded.Value) cp.ClassName = "RICHEDIT50W";
                    return cp;
                }
            }
        }
    }
}
