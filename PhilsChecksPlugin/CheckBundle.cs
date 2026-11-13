using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Windows.Forms;

namespace PhilsChecks
{
    /// <summary>One check in one language, as the window lists it.</summary>
    public sealed class CheckInfo
    {
        public string Id;
        /// <summary>The folder it runs from: "en", "es" or "fr".</summary>
        public string Lang;
        public string CmsFile;
        /// <summary>The help .rtf, "" when there is none.</summary>
        public string HelpFile;
        /// <summary>The folder ("en", "es" or "fr") holding <see cref="HelpFile"/>: "en" when a Spanish or French check
        /// has no help of its own and the English check's is used (1.4, the user's choice for now).</summary>
        public string HelpLang;
        /// <summary>The help file's full path, set before a run (null = not prepared).</summary>
        public string HelpPath;
        public string Name;
        public string Description;
        /// <summary>The .cms has \outputProject: the check writes text into a project.</summary>
        public bool ChangesText;
        /// <summary>Spanish or French was asked for, but the check exists only in English.</summary>
        public bool EnglishOnly;
    }

    /// <summary>Runs a check (Paratext's runner in the plugin, a fake in the test host).</summary>
    public interface ICheckRunner
    {
        void Run(CheckInfo check, string folder, IWin32Window owner);
    }

    /// <summary>
    /// The checks the plugin carries (Resources\checks.zip, made by tools\make_bundle.py), and
    /// their copy on disk. Python imports scripts from a folder, so the files are written to
    /// %LOCALAPPDATA%\PhilsChecks\checks\en, \es and \fr (only this user can write there). Before every
    /// run <see cref="Prepare"/> compares each file with the SHA-256 in the bundle's manifest,
    /// writes again any that differ, and removes anything else in those folders, so only the
    /// files that came with the plugin can run.
    /// </summary>
    public sealed class CheckBundle
    {
        public const string ResourceName = "PhilsChecks.checks.zip";
        public static readonly string[] Languages = { "en", "es", "fr" };

        private readonly Dictionary<string, byte[]> files = new Dictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, string> hashes = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        private readonly List<string[]> index = new List<string[]>();

        public string Root { get; private set; }

        public CheckBundle(Stream zip, string root)
        {
            Root = root;
            using (var archive = new ZipArchive(zip, ZipArchiveMode.Read))
            {
                foreach (ZipArchiveEntry e in archive.Entries)
                {
                    if (e.FullName.EndsWith("/")) continue;
                    using (Stream s = e.Open())
                    using (var m = new MemoryStream())
                    {
                        s.CopyTo(m);
                        files[e.FullName] = m.ToArray();
                    }
                }
            }
            foreach (string line in Lines("manifest.txt"))
            {
                string[] parts = line.Split('\t');
                if (parts.Length != 2) throw new InvalidDataException("bad manifest line: " + line);
                byte[] data;
                if (!files.TryGetValue(parts[0], out data) || Sha256(data) != parts[1])
                    throw new InvalidDataException("the bundle does not match its manifest: " + parts[0]);
                hashes[parts[0]] = parts[1];
            }
            foreach (string line in Lines("index.txt"))
            {
                string[] parts = line.Split('\t');
                if (parts.Length != 4 || !hashes.ContainsKey(parts[1] + "/" + parts[2]))
                    throw new InvalidDataException("bad index line: " + line);
                index.Add(parts);
            }
        }

        /// <summary>The bundle inside the plugin dll.</summary>
        public static CheckBundle FromPlugin()
        {
            Stream zip = typeof(CheckBundle).Assembly.GetManifestResourceStream(ResourceName);
            if (zip == null) throw new InvalidDataException(ResourceName + " is missing from the plugin");
            using (zip)
                return new CheckBundle(zip, DefaultRoot());
        }

        public static string DefaultRoot()
        {
#if PC_TESTHOST
            string over = Environment.GetEnvironmentVariable("PC_ROOT");
            if (!string.IsNullOrEmpty(over)) return over;
#endif
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PhilsChecks", "checks");
        }

        private IEnumerable<string> Lines(string name)
        {
            byte[] data;
            if (!files.TryGetValue(name, out data)) throw new InvalidDataException(name + " is missing from the bundle");
            return Encoding.UTF8.GetString(data).Split('\n').Select(l => l.TrimEnd('\r')).Where(l => l.Length > 0);
        }

        /// <summary>
        /// The checks in <paramref name="lang"/> ("en", "es" or "fr"), in alphabetical order of their
        /// names (the user's request, 1.3; compared as in that language, ignoring case). A check
        /// with no Spanish version is listed in English, marked EnglishOnly.
        /// </summary>
        public List<CheckInfo> Checks(string lang)
        {
            var result = new List<CheckInfo>();
            foreach (string id in index.Select(p => p[0]).Distinct())
            {
                string[] row = index.FirstOrDefault(p => p[0] == id && p[1] == lang)
                               ?? index.FirstOrDefault(p => p[0] == id && p[1] == "en")
                               ?? index.First(p => p[0] == id);
                var c = new CheckInfo();
                c.Id = id;
                c.Lang = row[1];
                c.CmsFile = row[2];
                c.HelpFile = row[3];
                c.HelpLang = row[1];
                if (c.HelpFile.Length == 0 && row[1] != "en")
                {
                    string[] en = index.FirstOrDefault(p => p[0] == id && p[1] == "en");
                    if (en != null && en[3].Length > 0)
                    {
                        c.HelpFile = en[3];
                        c.HelpLang = "en";
                    }
                }
                c.EnglishOnly = lang != "en" && row[1] == "en";
                ReadHeader(files[row[1] + "/" + row[2]], c);
                result.Add(c);
            }
            StringComparer cmp = StringComparer.Create(
                new System.Globalization.CultureInfo(lang == "es" ? "es-ES" : lang == "fr" ? "fr-FR" : "en-US"), true);
            return result.OrderBy(c => c.Name, cmp).ThenBy(c => c.Id, StringComparer.Ordinal).ToList();
        }

        /// <summary>\check, \description and \outputProject of a .cms file.</summary>
        internal static void ReadHeader(byte[] cms, CheckInfo c)
        {
            string text = new StreamReader(new MemoryStream(cms), Encoding.UTF8, true).ReadToEnd();
            foreach (string raw in text.Split('\n'))
            {
                string line = raw.TrimEnd('\r');
                Match m = Regex.Match(line, @"^\\(\w+)\s*(.*)$");
                if (!m.Success) continue;
                string tag = m.Groups[1].Value.ToLowerInvariant();
                string arg = m.Groups[2].Value.Trim();
                if (tag == "check" && c.Name == null) c.Name = arg;
                else if (tag == "description" && c.Description == null) c.Description = arg;
                else if (tag == "outputproject") c.ChangesText = true;
            }
            if (c.Name == null) c.Name = c.CmsFile;
            if (c.Description == null) c.Description = "";
        }

        /// <summary>
        /// Makes the folder of <paramref name="lang"/> hold exactly the bundle's files and returns it.
        /// </summary>
        public string Prepare(string lang)
        {
            string dir = Path.Combine(Root, lang);
            Directory.CreateDirectory(dir);
            RefuseLink(Root);
            RefuseLink(dir);

            var wanted = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (KeyValuePair<string, string> h in hashes)
            {
                if (!h.Key.StartsWith(lang + "/", StringComparison.OrdinalIgnoreCase)) continue;
                string name = h.Key.Substring(lang.Length + 1);
                wanted.Add(name);
                string path = Path.Combine(dir, name);
                if (File.Exists(path) && FileHash(path) == h.Value) continue;
                if (File.Exists(path))
                {
                    File.SetAttributes(path, FileAttributes.Normal);
                    File.Delete(path);
                }
                using (var f = new FileStream(path, FileMode.CreateNew, FileAccess.Write))
                {
                    byte[] data = files[h.Key];
                    f.Write(data, 0, data.Length);
                }
                if (FileHash(path) != h.Value)
                    throw new IOException("could not write " + path);
            }

            // Anything else could be imported by a check (a .py, or a folder with __init__.py).
            foreach (string path in Directory.GetFiles(dir))
            {
                if (wanted.Contains(Path.GetFileName(path))) continue;
                File.SetAttributes(path, FileAttributes.Normal);
                File.Delete(path);
            }
            foreach (string sub in Directory.GetDirectories(dir))
                DeleteTree(sub);
            return dir;
        }

        private static void RefuseLink(string dir)
        {
            if ((File.GetAttributes(dir) & FileAttributes.ReparsePoint) != 0)
                throw new IOException(dir + " is a link");
        }

        /// <summary>Deletes a folder; a link is removed without touching what it points to.</summary>
        private static void DeleteTree(string dir)
        {
            if ((File.GetAttributes(dir) & FileAttributes.ReparsePoint) == 0)
            {
                foreach (string f in Directory.GetFiles(dir))
                {
                    File.SetAttributes(f, FileAttributes.Normal);
                    File.Delete(f);
                }
                foreach (string sub in Directory.GetDirectories(dir))
                    DeleteTree(sub);
            }
            Directory.Delete(dir, false);
        }

        private static string FileHash(string path)
        {
            return Sha256(File.ReadAllBytes(path));
        }

        internal static string Sha256(byte[] data)
        {
            using (var sha = SHA256.Create())
                return string.Concat(sha.ComputeHash(data).Select(b => b.ToString("x2")));
        }
    }
}
