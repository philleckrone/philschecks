# -*- coding: utf-8 -*-
# Tests the tool windows' project-folder side in headless Edge, with a fake folder tree made of a
# real project's files (default: Paratext 10's copy of PDT15):
#     projects\Paratext 9 Projects\PDT15\...       the project (its real files)
#     projects\Paratext 9 Projects\OTHER\...       another project (another <Guid>)
#     projects\Paratext 9 Projects\RENAMED\...     (only in the by-Guid test) PDT15 under another name
# Checks: choosing the projects folder once (or the projects folder one level up, or the project
# folder itself); a remembered projects folder opening with no click (permission granted) or one
# click (permission to ask); finding the project by Guid; a projects folder without the project;
# another project's folder refused; one report at start (no second scan); the webkitdirectory
# fallback; NBT sends BookNames.xml; Project Settings sends the folder's files.
#     python tests/folder_ui_test.py [PROJECTDIR]
# Each page writes PASS/FAIL lines into <pre id="result">, read back with --dump-dom. Waits use
# __until(cond), which yields real I/O turns (--virtual-time-budget fast-forwards timers only).
import html as htmlmod, importlib.util, json, os, re, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
EXT = os.path.dirname(HERE)
EDGE = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
DEFAULT = os.path.join(os.environ['USERPROFILE'], '.paratext-10-studio', 'projects', 'Paratext 9 Projects', 'PDT15')

spec = importlib.util.spec_from_file_location('build', os.path.join(EXT, 'tools', 'build.py'))
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)


def project_files(d):
    out = {}
    for n in os.listdir(d):
        low = n.lower()
        if low in ('settings.xml', 'booknames.xml', 'custom.sty', 'custom.vrs', 'autocorrect.txt') or low.endswith('.ldml'):
            with open(os.path.join(d, n), 'rb') as f:
                out[n] = list(f.read())
    return out


def guid_of(files):
    m = re.search(r'<Guid>\s*([^<\s]*)', bytes(files['Settings.xml']).decode('utf-8-sig'))
    return m.group(1).upper() if m else 'X'


# The fake folder tree, store and papi. __TREE__ = {name: files | {subtree}} (files = {name: [bytes]}).
HARNESS = r"""
<script>
window.__results = [];
function __ok(cond, what) { window.__results.push((cond ? 'PASS ' : 'FAIL ') + what); }
async function __until(cond) { for (let i = 0; i < 400 && !cond(); i++) await new Blob([new Uint8Array(4096)]).arrayBuffer(); }
window.__written = null;
window.__downloaded = null;
window.__calls = [];
window.__perm = __PERM__;            // what queryPermission answers
window.__asked = 0;                  // requestPermission calls
window.__pickerCalls = 0;
HTMLAnchorElement.prototype.click = function () { window.__downloaded = this.download; };
function __fileHandle(name, bytes) {
  return { kind: 'file', name: name,
    getFile: async () => new File([new Uint8Array(bytes)], name, { lastModified: 1700000000000 }),
    createWritable: async () => { const parts = []; return { write: async (b) => parts.push(b), close: async () => { window.__written = parts[0]; } }; } };
}
// A folder: entries whose value is an array are files, objects are subfolders.
function __dir(name, tree) {
  return { kind: 'directory', name: name,
    values: async function* () { for (const n of Object.keys(tree)) yield Array.isArray(tree[n]) ? __fileHandle(n, tree[n]) : __dir(n, tree[n]); },
    getDirectoryHandle: async (n) => { if (tree[n] && !Array.isArray(tree[n])) return __dir(n, tree[n]); const e = new Error('not found'); e.name = 'NotFoundError'; throw e; },
    getFileHandle: async (n) => __fileHandle(n, tree[n] || []),
    queryPermission: async () => window.__perm,
    requestPermission: async () => { window.__asked++; return 'granted'; } };
}
window.__tree = __TREE__;
window.__top = __dir('projects', window.__tree);
function __at(path) { let d = window.__top; for (const p of path) d = { name: p, tree: null, h: null } && __dirOf(path); return __dirOf(path); }
function __dirOf(path) { let t = window.__tree; let name = 'projects'; for (const p of path) { t = t[p]; name = p; } return __dir(name, t); }
// The folder the chooser returns, and what is remembered (instead of IndexedDB).
window.__pick = __PICK__;
window.__store = {};
const __pre = __REMEMBER__;
if (__pre) window.__store['__projectsRoot'] = __dirOf(__pre);
window.__pcFolderStore = { get: (k) => window.__store[k] || null, put: (k, h) => { window.__store[k] = h; } };
if (__PICKER__) window.showDirectoryPicker = async (opts) => { window.__pickerCalls++; window.__pickerMode = opts && opts.mode; return __dirOf(window.__pick); };
else {
  delete window.showDirectoryPicker;
  const click = HTMLInputElement.prototype.click;
  HTMLInputElement.prototype.click = function () {
    if (!this.webkitdirectory) return click.call(this);
    let t = window.__tree; for (const p of window.__pick) t = t[p];
    const dt = new DataTransfer();
    Object.keys(t).filter((n) => Array.isArray(t[n])).forEach((n) => {
      const f = new File([new Uint8Array(t[n])], n, { lastModified: 1700000000000 });
      Object.defineProperty(f, 'webkitRelativePath', { value: window.__pick[window.__pick.length - 1] + '/' + n });
      dt.items.add(f);
    });
    Object.defineProperty(this, 'files', { value: dt.files });
    setTimeout(() => this.dispatchEvent(new Event('change')), 10);
  };
}
window.require = function () {
  return { logger: console, commands: { sendCommand: function (name) {
    window.__calls.push({ name: name, args: Array.prototype.slice.call(arguments, 1) });
    if (/\.books$/.test(name)) return Promise.resolve([]);
    if (/\.(scan|scanWith|apply)$/.test(name)) return Promise.resolve(__STATE__);
    return Promise.resolve(null);
  } } };
};
</script>
"""


def page(folder, tool_id, steps, tree, pick, picker=True, perm='granted', remember=None, state=None, project_id=None):
    strings = json.load(open(os.path.join(EXT, 'src', 'tools', folder, 'strings.json'), encoding='utf-8'))
    boot = {'projectId': project_id, 'lang': 'en', 'projectName': 'PDT15', 'version': strings['version'], 'id': tool_id, 'strings': strings['en']}
    h = build.tool_window(folder).replace('__BOOT__', json.dumps(boot))
    harness = (HARNESS.replace('__TREE__', json.dumps(tree)).replace('__PICK__', json.dumps(pick))
               .replace('__PICKER__', 'true' if picker else 'false').replace('__PERM__', json.dumps(perm))
               .replace('__REMEMBER__', json.dumps(remember)).replace('__STATE__', json.dumps(state or {})))
    run = ('<script>setTimeout(async function(){try{' + steps + '}catch(e){__ok(false, "error: " + e);}'
           'var p=document.createElement("pre");p.id="result";p.textContent=window.__results.join("\\n");document.body.appendChild(p);},500);</script>')
    h = h.replace('<script>', harness + '\n<script>', 1)
    at = h.rfind('</body>')  # the last one: a window's script may hold the text '</body>'
    return h[:at] + run + h[at:]


def run_page(h, tmp, label):
    p = os.path.join(tmp, label + '.html')
    with open(p, 'w', encoding='utf-8') as f:
        f.write(h)
    # Each page gets its own browser profile: runs that share the default one sometimes return an
    # empty page. A page with no result is tried once more.
    for attempt in range(2):
        profile = os.path.join(tmp, '%s_profile%d' % (label, attempt))
        out = subprocess.run([EDGE, '--headless=new', '--disable-gpu', '--user-data-dir=' + profile, '--virtual-time-budget=8000',
                              '--dump-dom', 'file:///' + p.replace('\\', '/')],
                             capture_output=True, timeout=120).stdout.decode('utf-8', 'replace')
        m = re.search(r'<pre id="result">(.*?)</pre>', out, re.S)
        if m:
            break
    lines = htmlmod.unescape(m.group(1)).splitlines() if m else ['FAIL no result from the page']
    return ['%s: %s' % (label, l) for l in lines]


def button(text):
    return "Array.from(document.querySelectorAll('button')).find(b=>b.textContent===%s)" % json.dumps(text)


def main():
    proj = sys.argv[1] if len(sys.argv) > 1 else DEFAULT
    files = project_files(proj)
    pid = guid_of(files)
    other = dict(files)
    other['Settings.xml'] = list(bytes(files['Settings.xml']).decode('utf-8-sig').replace('<Guid>', '<Guid>00').replace('<Name>PDT15</Name>', '<Name>OTHER</Name>').encode('utf-8'))
    tree = {'Paratext 9 Projects': {'OTHER': other, 'PDT15': files}}
    renamed = {'Paratext 9 Projects': {'OTHER': other, 'RENAMED': files}}
    without = {'Paratext 9 Projects': {'OTHER': other}}
    common = json.load(open(os.path.join(EXT, 'src', 'tools', 'common-strings.json'), encoding='utf-8'))['en']
    choose_root = button(common['FolderChooseRoot']) + '.click();'
    open_project = button(common['FolderOpenProject'].replace('{0}', 'PDT15'))
    folder_text = "document.getElementById('folderRow').textContent"
    # Project Settings sends the folder's files with apply; without a folder it scans Paratext 10's settings.
    applied = "await __until(()=>window.__calls.some(c=>/apply$/.test(c.name)));"
    apply_call = "window.__calls.find(c=>/apply$/.test(c.name))"
    sent_ok = ("(()=>{const c=" + apply_call + ";const f=c?Object.keys(c.args[1].files):[];"
               "return f.indexOf('Settings.xml')>=0&&f.some(n=>/\\.ldml$/i.test(n))&&c.args[1].meta.__folder===true;})()")
    no_apply = "!window.__calls.some(c=>/apply$/.test(c.name))"
    scanned = "window.__calls.some(c=>/projectSettings\\.scan$/.test(c.name))"
    ps_state = {'html': '<html><head><style></style></head><body>report</body></html>', 'source': 'files', 'files': [], 'failed': []}
    tmp = tempfile.mkdtemp(prefix='folder_ui_')
    results = []

    def ps(label, steps, t, pick, **kw):
        return run_page(page('project-settings', 'projectSettings', steps, t, pick, state=ps_state, project_id=pid, **kw), tmp, label)

    # 1. First time: choose the projects folder; the project's subfolder is found and read.
    steps = ("__ok(!!" + button(common['FolderChooseRoot']) + ",'first time: the button is \"Choose the Paratext 9 Projects folder...\"');"
             "__ok(" + folder_text + ".indexOf('Paratext 9 Projects')>=0,'first time: it says where that folder is');"
             "await __until(()=>" + scanned + ");__ok(" + scanned + ",'first time: the report starts from Paratext 10\\'s settings');" +
             choose_root + applied +
             "__ok(" + sent_ok + ",'the PDT15 subfolder was found and its files sent: '+Object.keys(" + apply_call + ".args[1].files).join(', '));"
             "__ok(window.__pickerMode==='read','the folder is asked for reading only');"
             "__ok(!!window.__store['__projectsRoot'],'the projects folder is remembered');")
    results += ps('first-time', steps, tree, ['Paratext 9 Projects'])

    # 2. Remembered, permission still granted: opens with no click (Project Settings, NBT), one report only.
    steps = (applied + "__ok(" + sent_ok + ",'no click: Project Settings reads the folder by itself');"
             "__ok(window.__pickerCalls===0&&window.__asked===0,'no chooser and no permission prompt');"
             "__ok(!" + scanned + ",'only one report at start (no second scan)');")
    results += ps('no-click-ps', steps, tree, [], remember=['Paratext 9 Projects'])
    nbt_state = {'rows': [], 'matrix': {'fields': [], 'usual': [], 'rows': []}, 'summary': '', 'numberedBooks': 17, 'bookNames': True, 'canEdit': True, 'failed': [], 'books': []}
    steps = ("await __until(()=>window.__calls.some(c=>/scanWith$/.test(c.name)));"
             "const c=window.__calls.find(c=>/scanWith$/.test(c.name));"
             "__ok(!!c&&/<book /.test(c.args[1].bookNamesXml||''),'no click: Numbered Book Titles reads BookNames.xml by itself');"
             "__ok(!window.__calls.some(c=>/numberedBookTitles\\.scan$/.test(c.name)),'Numbered Book Titles: only one scan at start');")
    results += run_page(page('numbered-book-titles', 'numberedBookTitles', steps, tree, [], remember=['Paratext 9 Projects'], state=nbt_state, project_id=pid), tmp, 'no-click-nbt')

    # 3. Remembered, permission to ask: one click.
    steps = ("await __until(()=>!!" + open_project + "&&" + scanned + ");"
             "__ok(!!" + open_project + "&&" + no_apply + ",'permission to ask: \"Open the project folder (PDT15)\", the report from Paratext 10 meanwhile');" +
             open_project + ".click();" + applied +
             "__ok(" + sent_ok + "&&window.__asked===1&&window.__pickerCalls===0,'one click: permission asked once, no chooser, the folder read');")
    results += ps('one-click', steps, tree, [], perm='prompt', remember=['Paratext 9 Projects'])

    # 4. Found by Guid under another folder name; 5. not there; 6. one level up; 7. the project itself; 8. another project.
    results += ps('by-guid', choose_root + applied + "__ok(" + sent_ok + ",'found by its Guid in a folder with another name');", renamed, ['Paratext 9 Projects'])
    steps = (choose_root + "await __until(()=>/no folder for the project/.test(" + folder_text + "));"
             "__ok(/no folder for the project PDT15/.test(" + folder_text + ")&&" + no_apply + ",'a projects folder without PDT15 is reported');")
    results += ps('not-there', steps, without, ['Paratext 9 Projects'])
    results += ps('level-up', choose_root + applied + "__ok(" + sent_ok + ",'the projects folder one level up also works');", tree, [])
    steps = (choose_root + applied + "__ok(" + sent_ok + ",'choosing the project folder itself also works');"
             "__ok(!window.__store['__projectsRoot']&&!!window.__store[" + json.dumps(pid) + "],'and it is remembered for this project only');")
    results += ps('project-itself', steps, tree, ['Paratext 9 Projects', 'PDT15'])
    steps = (choose_root + "await __until(()=>/not of the project open here/.test(" + folder_text + "));"
             "__ok(/not of the project open here/.test(" + folder_text + ")&&" + no_apply + ",'another project\\'s folder is refused');")
    results += ps('wrong-project', steps, tree, ['Paratext 9 Projects', 'OTHER'])

    # 9. Without showDirectoryPicker: the folder input (read only) still sends the files.
    results += ps('fallback', choose_root + applied + "__ok(" + sent_ok + ",'fallback folder input: the files are sent');", tree, ['Paratext 9 Projects', 'PDT15'], picker=False)

    fails = [r for r in results if ': FAIL' in r]
    for r in results:
        print(r)
    print('%d checks, %d failed' % (len(results), len(fails)))
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
