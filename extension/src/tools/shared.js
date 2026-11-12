// Built-in tools: the plumbing a tool window shares (Numbered Markers, Numbered Book Titles).
// PCTools.backend(spec) registers, for spec.id = 'numberedMarkers':
//   numberedMarkers.open(editorWebViewId, projectId)   the tool's window (one per project)
//   numberedMarkers.scan(projectId, runId)              spec.scan(ctx, lang, null) on the chosen books
//   numberedMarkers.scanWith(projectId, extra, runId)   the same with extra from the window (files it read)
//   numberedMarkers.apply(projectId, payload, runId)    spec.apply(ctx, payload): writes text
//   numberedMarkers.progress(projectId, runId)          what the window shows while it waits
//   numberedMarkers.books(projectId) / saveBooks(projectId, excludedCodes)
//   numberedMarkers.goTo(projectId, book, chapter, verse)
// Writing: the whole book, after keeping its old text in the extension's storage
// (backup:<project>:<BOOK>:<time>), then read back. Paratext 10 has no history points.
// Uses papi only at run time; spec.html is the window with __BOOT__ in it.
var PCTools = (function () {
  'use strict';

  function backend(spec) {
    const papi = require('@papi/backend');
    const { logger } = papi;
    const runs = new Map();
    let token;

    function docs(summary) {
      return { method: { summary, params: [], result: { name: 'return value', schema: {} } } };
    }
    function ref(code, chapter, verse) {
      return { book: code, chapterNum: chapter || 1, verseNum: verse || 0 };
    }
    function progress(projectId, runId, data) {
      if (runId) runs.set(`${projectId}|${runId}`, Object.assign({ runId }, data));
    }
    function done(projectId, runId) {
      if (runId) setTimeout(() => runs.delete(`${projectId}|${runId}`), 5000);
    }

    async function language() {
      try {
        const langs = await papi.settings.get('platform.interfaceLanguage');
        const first = Array.isArray(langs) && langs.length > 0 ? String(langs[0]).toLowerCase() : 'en';
        if (first.startsWith('es')) return 'es';
        if (first.startsWith('fr')) return 'fr';
      } catch (e) {
        // English
      }
      return 'en';
    }

    const names = new Map();
    async function projectName(projectId, wait) {
      if (names.has(projectId)) return names.get(projectId);
      const p = (async () => {
        try {
          const base = await papi.projectDataProviders.get('platform.base', projectId);
          const n = (await base.getSetting('platform.name')) || projectId;
          names.set(projectId, n);
          return n;
        } catch (e) {
          return projectId;
        }
      })();
      return wait ? Promise.race([p, new Promise((r) => setTimeout(() => r(''), wait))]) : p;
    }

    async function booksPresent(projectId) {
      const base = await papi.projectDataProviders.get('platform.base', projectId);
      const present = String((await base.getSetting('platformScripture.booksPresent')) || '');
      const list = [];
      for (let i = 0; i < present.length && i < PC.usfm.BOOKS.length; i++)
        if (present[i] === '1') list.push({ num: i + 1, code: PC.usfm.bookCode(i + 1) });
      return list;
    }

    /** The excluded book codes (null = none saved: every book). */
    async function loadExcluded(projectId) {
      try {
        const v = JSON.parse(await papi.storage.readUserData(token, `books:${spec.id}:${projectId}`));
        return Array.isArray(v) ? v : null;
      } catch (e) {
        return null;
      }
    }

    async function books(projectId) {
      const present = await booksPresent(projectId);
      const excluded = await loadExcluded(projectId);
      return present.map((b) => ({ code: b.code, num: b.num, chosen: !excluded || excluded.indexOf(b.code) < 0 }));
    }

    async function saveBooks(projectId, excludedCodes) {
      await papi.storage.writeUserData(token, `books:${spec.id}:${projectId}`, JSON.stringify(excludedCodes || []));
      return true;
    }

    async function canEdit(projectId) {
      try {
        const perm = await papi.projectDataProviders.get('platformScripture.scriptureEditPermissions', projectId);
        return await perm.canUserEditScripture();
      } catch (e) {
        logger.warn(`${spec.id}: could not read edit permission: ${e}`);
        return true;
      }
    }

    /** What spec.scan and spec.apply get. */
    function context(projectId, runId) {
      let pdp;
      async function usfm() {
        if (!pdp) pdp = await papi.projectDataProviders.get('platformScripture.USFM_Book', projectId);
        return pdp;
      }
      return {
        projectId,
        logger,
        progress: (data) => progress(projectId, runId, data),
        /** The chosen books' text: [{num, code, text}], with "Reading X (n of m)" progress. */
        async readChosen() {
          const list = (await books(projectId)).filter((b) => b.chosen);
          const out = [];
          const failed = [];
          const p = await usfm();
          for (let i = 0; i < list.length; i++) {
            progress(projectId, runId, { phase: 'read', done: i, total: list.length, book: list[i].code });
            try {
              const text = await p.getBookUSFM(ref(list[i].code, 1, 1));
              if (text !== undefined && text !== null) out.push({ num: list[i].num, code: list[i].code, text });
            } catch (e) {
              failed.push(`${list[i].code}: ${e}`);
            }
          }
          progress(projectId, runId, { phase: 'check', done: list.length, total: list.length });
          return { books: out, failed, total: list.length };
        },
        async readBook(code) {
          return (await usfm()).getBookUSFM(ref(code, 1, 1));
        },
        canEdit: () => canEdit(projectId),
        /** A project setting from Paratext 10, or undefined when it has none (or refuses the key). */
        async setting(key) {
          try {
            const base = await papi.projectDataProviders.get('platform.base', projectId);
            return await base.getSetting(key);
          } catch (e) {
            return undefined;
          }
        },
        /** Paratext 10's merged stylesheet (StyleInfo) for a book, or undefined. */
        async styleInfo(bookNum) {
          try {
            const pdp = await papi.projectDataProviders.get('platformScripture.StyleInfo', projectId);
            return await pdp.getStyleInfo(bookNum || 1);
          } catch (e) {
            return undefined;
          }
        },
        projectName: () => projectName(projectId),
        /**
         * Keeps the old text, writes the new, reads it back. Returns {ok, error, after, backup}.
         * stamp is one time for the whole run.
         */
        async writeBook(code, oldText, newText, stamp) {
          const backup = `backup:${projectId}:${code}:${stamp}`;
          try {
            await papi.storage.writeUserData(token, backup, oldText);
          } catch (e) {
            return { ok: false, error: `the backup could not be written, so the book was not changed (${e})` };
          }
          const p = await usfm();
          try {
            await p.setBookUSFM(ref(code, 1, 1), newText);
          } catch (e) {
            return { ok: false, error: String(e && e.message ? e.message : e) };
          }
          let after;
          try {
            after = await p.getBookUSFM(ref(code, 1, 1));
          } catch (e) {
            after = undefined;
          }
          if (after === oldText) return { ok: false, error: 'notSaved', backup };
          return { ok: true, after, backup };
        },
        stamp: () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, ''),
      };
    }

    /** scanWith: the same, with what the window read from the project folder (e.g. {bookNamesXml}). */
    async function scan(projectId, runId, extra) {
      try {
        progress(projectId, runId, { phase: 'open', done: 0, total: 0 });
        logger.info(`${spec.id}: scan started for ${projectId}${extra ? ' (with the project folder)' : ''}`);
        const result = await spec.scan(context(projectId, runId), await language(), extra || null);
        result.books = await books(projectId);
        result.canEdit = await canEdit(projectId);
        return result;
      } finally {
        done(projectId, runId);
      }
    }

    async function apply(projectId, payload, runId) {
      try {
        logger.info(`${spec.id}: apply started for ${projectId}`);
        return await spec.apply(context(projectId, runId), payload, await language());
      } finally {
        done(projectId, runId);
      }
    }

    async function goTo(projectId, code, chapter, verse) {
      await papi.scrollGroups.setScrRef(undefined, ref(code, chapter || 1, verse || 0), projectId);
      return true;
    }

    async function html(projectId) {
      const lang = await language();
      const boot = {
        projectId,
        lang,
        projectName: await projectName(projectId, 300),
        version: spec.version,
        id: spec.id,
        strings: Object.assign({}, spec.strings.en, spec.strings[lang] || {}),
      };
      const json = JSON.stringify(boot).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
      return spec.html.replace('__BOOT__', json);
    }

    const provider = {
      async getWebView(saved, options) {
        if (saved.webViewType !== spec.webViewType) throw new Error(`${spec.webViewType} provider got ${saved.webViewType}`);
        const projectId = (options && options.projectId) || saved.projectId;
        if (!projectId) return undefined;
        const lang = await language();
        const title = (spec.strings[lang] || spec.strings.en).Title || spec.id;
        const name = await projectName(projectId, 300);
        return { ...saved, title: name ? `${title} - ${name}` : title, projectId, contentType: 'html', content: await html(projectId) };
      },
    };

    async function open(editorWebViewId, givenProjectId) {
      let projectId = typeof givenProjectId === 'string' && givenProjectId ? givenProjectId : undefined;
      if (!projectId && typeof editorWebViewId === 'string' && editorWebViewId) {
        try {
          const def = await papi.webViews.getOpenWebViewDefinition(editorWebViewId);
          projectId = def && def.projectId;
        } catch (e) {
          logger.warn(`${spec.id}: could not read the editor's project: ${e}`);
        }
      }
      if (!projectId) {
        try {
          projectId = await papi.dialogs.selectProject({ title: spec.strings.en.Title, includeProjectInterfaces: ['platformScripture.USFM_Book'] });
        } catch (e) {
          logger.warn(`${spec.id}: project chooser failed: ${e}`);
        }
      }
      if (!projectId) return undefined;
      return papi.webViews.openWebView(spec.webViewType, { type: 'float', floatSize: spec.size || { width: 1100, height: 720 } }, {
        existingId: '?',
        existingProjectId: projectId,
        projectId,
      });
    }

    async function activate(context) {
      token = context.executionToken;
      const register = papi.webViewProviders.registerWebViewProvider || papi.webViewProviders.register;
      const regs = await Promise.all([
        register.call(papi.webViewProviders, spec.webViewType, provider),
        papi.commands.registerCommand(`${spec.id}.open`, open, docs(`Open the ${spec.strings.en.Title} window`)),
        papi.commands.registerCommand(`${spec.id}.scan`, (projectId, runId) => scan(projectId, runId, null), docs(`${spec.strings.en.Title}: scan a project`)),
        papi.commands.registerCommand(
          `${spec.id}.scanWith`,
          (projectId, extra, runId) => scan(projectId, runId, extra),
          docs(`${spec.strings.en.Title}: scan a project with files from its folder`),
        ),
        papi.commands.registerCommand(`${spec.id}.apply`, apply, docs(`${spec.strings.en.Title}: change the text`)),
        papi.commands.registerCommand(
          `${spec.id}.progress`,
          async (projectId, runId) => runs.get(`${projectId}|${runId}`) || null,
          docs('Progress of a scan or change'),
        ),
        papi.commands.registerCommand(`${spec.id}.books`, books, docs('The books of a project and the saved choice')),
        papi.commands.registerCommand(`${spec.id}.saveBooks`, saveBooks, docs('Save the books to examine')),
        papi.commands.registerCommand(`${spec.id}.goTo`, goTo, docs('Go to a place in the text')),
      ]);
      regs.forEach((r) => context.registrations.add(r));
    }

    return { activate, deactivate: async () => true, open };
  }

  return { backend: backend };
})();
