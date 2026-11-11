using System;
using System.Collections.Generic;
using System.Windows.Forms;
using Paratext.PluginInterfaces;

namespace PhilsChecks
{
    /// <summary>
    /// Paratext plugin that adds Tools > Phils Custom (cms) Checks...: a list of the CMS checks the plugin
    /// carries, run through Paratext's own check window and runner, without copying them into the
    /// cms folder.
    /// </summary>
    public class PhilsChecksPlugin : IParatextStandalonePlugin
    {
        public const string PluginName = "Phils Custom (cms) Checks";
        public const string PublisherName = "Phil Leckrone (SIL)";

        /// <summary>The open window of each project (by project ID): a second click brings it to the front.</summary>
        private static readonly Dictionary<string, ChecksForm> OpenWindows = new Dictionary<string, ChecksForm>();

        private static CheckBundle bundle;
        private static ParatextCms cms;
        private static string cmsProblem;

        private IPluginHost host;

        public PhilsChecksPlugin()
        {
        }

        public PhilsChecksPlugin(IPluginHost host)
        {
            this.host = host;
        }

        public string Name
        {
            get { return PluginName; }
        }

        public Version Version
        {
            get { return new Version(Strings.ToolVersion); }
        }

        public string VersionString
        {
            get { return Strings.ToolVersion; }
        }

        public string Publisher
        {
            get { return PublisherName; }
        }

        public IEnumerable<PluginMenuEntry> PluginMenuEntries
        {
            get
            {
                var entry = new PluginMenuEntry(Strings.English_().MenuText, OnMenuClicked, PluginMenuLocation.ScrTextTools);
                entry.LocalizedTextNeeded += LocalizeMenuText;
                yield return entry;
            }
        }

        /// <summary>Menu text in Paratext's interface language; null keeps English.</summary>
        internal static string LocalizeMenuText(string defaultText, string locale)
        {
            return Strings.LanguageOf(locale) != Lang.English ? Strings.For(locale).MenuText : null;
        }

        public string GetDescription(string locale)
        {
            return Strings.For(locale).Description;
        }

        public IDataFileMerger GetMerger(IPluginHost pluginHost, string dataIdentifier)
        {
            return null;   // the plugin keeps no project data
        }

        private void OnMenuClicked(IPluginHost pluginHost, IParatextChildState state)
        {
            if (host == null) host = pluginHost;
            Strings strings = Strings.For(UiLocale(host));
            try
            {
                IProject project = state != null ? state.Project : null;
                if (project == null || project.IsResource)
                {
                    Report(strings, strings.OpenProjectFirst, null);
                    return;
                }

                if (cms == null && cmsProblem == null) cms = ParatextCms.Load(out cmsProblem);
                if (cms == null)
                {
                    Report(strings, string.Format(strings.NotSupported, cmsProblem), null);
                    return;
                }
                if (bundle == null) bundle = CheckBundle.FromPlugin();

                string id = project.ID ?? project.ShortName;
                ChecksForm open;
                if (OpenWindows.TryGetValue(id, out open) && !open.IsDisposed)
                {
                    if (open.WindowState == FormWindowState.Minimized) open.WindowState = FormWindowState.Normal;
                    open.Activate();
                    return;
                }
                var form = new ChecksForm(bundle, cms.ForProject(project, strings.Viewer()), strings, project.ShortName);
                OpenWindows[id] = form;
                form.FormClosed += delegate
                {
                    OpenWindows.Remove(id);
                    form.Dispose();
                };
                form.Show();
            }
            catch (Exception ex)
            {
                Report(strings, string.Format(strings.Error, ex.Message), ex);
            }
        }

        private void Report(Strings strings, string message, Exception ex)
        {
            try
            {
                if (host != null)
                    host.Log(this, message + (ex != null ? "\n" + ex : ""));
            }
            catch (Exception) { }
            MessageBox.Show(message, strings.Title, MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }

        private static string UiLocale(IPluginHost pluginHost)
        {
            try
            {
                if (pluginHost != null && pluginHost.UserSettings != null)
                    return pluginHost.UserSettings.UiLocale;
            }
            catch (Exception) { }
            return null;
        }
    }
}
