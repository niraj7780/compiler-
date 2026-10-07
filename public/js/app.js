/* DevCode — frontend controller */
(function () {
  'use strict';

  var STORE_THEME = 'devcode.theme';
  var STORE_BUFFERS = 'devcode.buffers.v1';
  var STORE_LANG = 'devcode.lang';
  var STORE_STDIN = 'devcode.stdin';
  var CLIENT_TIMEOUT_MS = 60000;

  var $ = function (sel) {
    return document.querySelector(sel);
  };

  var els = {
    lang: $('#language'),
    runBtn: $('#run-btn'),
    themeToggle: $('#theme-toggle'),
    fileName: $('#file-name'),
    resetBtn: $('#reset-btn'),
    stdin: $('#stdin'),
    output: $('#output'),
    statusChip: $('#status-chip'),
    runMeta: $('#run-meta'),
    engineBadge: $('#engine-badge'),
    engineText: $('#engine-text'),
    cursorPos: $('#cursor-pos'),
    langInfo: $('#lang-info'),
    copyOutput: $('#copy-output'),
    clearOutput: $('#clear-output'),
    clearInput: $('#clear-input'),
    toast: $('#toast'),
  };

  var state = {
    languages: [],
    currentId: null,
    editor: null, // monaco editor or fallback textarea wrapper
    usingFallback: false,
    running: false,
    buffers: loadJSON(STORE_BUFFERS, {}) || {},
    theme: null,
    toastTimer: null,
  };

  /* ----------------------------- helpers ----------------------------- */

  function loadJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function saveJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      /* quota or private mode - ignore */
    }
  }

  function toast(message) {
    els.toast.textContent = message;
    els.toast.classList.add('is-visible');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(function () {
      els.toast.classList.remove('is-visible');
    }, 2200);
  }

  function setStatus(kind, label) {
    els.statusChip.className = 'status-chip is-' + kind;
    els.statusChip.textContent = label;
  }

  function clearOutput() {
    els.output.textContent = '';
    els.runMeta.textContent = '';
  }

  function addNotice(kind, text) {
    var div = document.createElement('div');
    div.className = 'notice notice-' + kind;
    div.textContent = text;
    els.output.appendChild(div);
  }

  function addStream(which, text) {
    var pre = document.createElement('pre');
    pre.className = 'stream stream-' + which;
    pre.textContent = text;
    els.output.appendChild(pre);
  }

  function showEmptyOutput(message) {
    var p = document.createElement('p');
    p.className = 'output-empty';
    p.textContent = message;
    els.output.appendChild(p);
  }

  function currentLanguage() {
    for (var i = 0; i < state.languages.length; i++) {
      if (state.languages[i].id === state.currentId) return state.languages[i];
    }
    return null;
  }

  /* ----------------------------- theme ----------------------------- */

  function applyTheme(theme) {
    state.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(STORE_THEME, theme);
    } catch (e) {
      /* ignore */
    }
    if (window.monaco && window.monaco.editor && window.monaco.editor.setTheme) {
      window.monaco.editor.setTheme(theme === 'dark' ? 'vs-dark' : 'vs');
    }
  }

  function initTheme() {
    var stored = null;
    try {
      stored = localStorage.getItem(STORE_THEME);
    } catch (e) {
      /* ignore */
    }
    var prefersLight =
      window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    applyTheme(stored || (prefersLight ? 'light' : 'dark'));
  }

  /* ----------------------------- editor ----------------------------- */

  function getCode() {
    if (!state.editor) return '';
    return state.editor.getValue ? state.editor.getValue() : state.editor.value;
  }

  function setCode(text) {
    if (!state.editor) return;
    if (state.editor.setValue) state.editor.setValue(text);
    else state.editor.value = text;
  }

  function setEditorLanguage(monacoId) {
    if (!state.editor) return;
    if (state.usingFallback) return;
    var model = state.editor.getModel && state.editor.getModel();
    if (model && window.monaco) {
      window.monaco.editor.setModelLanguage(model, monacoId);
    }
  }

  function saveBuffer() {
    if (!state.currentId) return;
    state.buffers[state.currentId] = getCode();
    saveJSON(STORE_BUFFERS, state.buffers);
  }

  function initMonaco() {
    if (!window.require) {
      initFallbackEditor();
      return;
    }

    // Monaco 0.57 ships prebuilt worker bundles under /monaco/vs/assets/* and
    // wires them up itself through the default MonacoEnvironment.
    var previousOnError = window.require.onError;
    window.require.onError = function (err) {
      if (previousOnError) previousOnError(err);
      if (err && err.requireModules && err.requireModules.length) {
        initFallbackEditor();
      }
    };

    window.require.config({ paths: { vs: '/monaco/vs' } });
    window.require(
      ['vs/editor/editor.main'],
      function () {
        createMonacoEditor();
      },
      function () {
        initFallbackEditor();
      }
    );
  }

  function createMonacoEditor() {
    var lang = currentLanguage();
    var model = window.monaco.editor.createModel(
      getCodeFor(lang),
      lang ? lang.monaco : 'plaintext'
    );

    state.editor = window.monaco.editor.create($('#editor'), {
      model: model,
      theme: state.theme === 'dark' ? 'vs-dark' : 'vs',
      automaticLayout: true,
      fontFamily:
        '"SFMono-Regular", ui-monospace, "JetBrains Mono", Menlo, Consolas, "Liberation Mono", monospace',
      fontSize: 13.5,
      lineHeight: 22,
      fontLigatures: true,
      tabSize: 4,
      insertSpaces: true,
      wordWrap: 'on',
      wordWrapColumn: 110,
      minimap: { enabled: window.innerWidth > 900 },
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      cursorSmoothCaretAnimation: 'on',
      renderLineHighlight: 'all',
      bracketPairColorization: { enabled: true },
      guides: { bracketPairs: true, indentation: true },
      autoClosingBrackets: 'always',
      autoClosingQuotes: 'always',
      padding: { top: 12, bottom: 12 },
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
      fixedOverflowWidgets: true,
      glyphMargin: false,
      folding: true,
      matchBrackets: 'always',
      overviewRulerLanes: 0,
      stickyScroll: { enabled: false },
    });

    state.editor.onDidChangeCursorPosition(function (e) {
      els.cursorPos.textContent =
        'Ln ' + e.position.lineNumber + ', Col ' + e.position.column;
    });
  }

  function initFallbackEditor() {
    if (state.editor) return;
    state.usingFallback = true;
    var host = $('#editor');
    host.textContent = '';
    var ta = document.createElement('textarea');
    ta.className = 'stdin-input';
    ta.spellcheck = false;
    ta.style.width = '100%';
    ta.style.height = '100%';
    ta.style.border = 'none';
    ta.style.outline = 'none';
    ta.style.resize = 'none';
    ta.style.padding = '14px';
    ta.style.background = 'var(--panel)';
    ta.style.color = 'var(--text)';
    ta.style.fontFamily = 'var(--font-mono)';
    ta.style.fontSize = '13.5px';
    ta.style.lineHeight = '1.6';
    ta.value = getCodeFor(currentLanguage());
    host.appendChild(ta);
    state.editor = ta;
    toast('Editor loaded in basic mode (Monaco unavailable)');
  }

  function getCodeFor(lang) {
    if (!lang) return '';
    if (Object.prototype.hasOwnProperty.call(state.buffers, lang.id)) {
      return state.buffers[lang.id];
    }
    return lang.starter || '';
  }

  /* ----------------------------- languages ----------------------------- */

  function renderLanguageSelect() {
    els.lang.textContent = '';
    state.languages.forEach(function (l) {
      var opt = document.createElement('option');
      opt.value = l.id;
      opt.textContent = l.name;
      els.lang.appendChild(opt);
    });
    els.lang.value = state.currentId;
  }

  function selectLanguage(id, initial) {
    var lang = null;
    for (var i = 0; i < state.languages.length; i++) {
      if (state.languages[i].id === id) lang = state.languages[i];
    }
    if (!lang) return;

    if (!initial) saveBuffer();

    state.currentId = lang.id;
    try {
      localStorage.setItem(STORE_LANG, lang.id);
    } catch (e) {
      /* ignore */
    }

    els.lang.value = lang.id;
    els.fileName.textContent = lang.file;
    els.langInfo.textContent = lang.name;

    if (state.editor && !initial) {
      setCode(getCodeFor(lang));
      setEditorLanguage(lang.monaco);
      if (state.editor.setPosition) state.editor.setPosition({ lineNumber: 1, column: 1 });
      if (state.editor.focus) state.editor.focus();
    }
  }

  /* ----------------------------- run ----------------------------- */

  function renderResult(data) {
    clearOutput();

    if (data.status === 'compile-error') {
      setStatus('compile', 'Compile error');
      addNotice('error', 'Compilation failed - fix the errors below and try again.');
      if (data.stderr) addStream('stderr', data.stderr);
      else if (data.stdout) addStream('stdout', data.stdout);
    } else if (data.status === 'timeout') {
      setStatus('timeout', 'Time limit exceeded');
      addNotice('warn', 'Execution stopped: time limit exceeded.');
      if (data.stdout) addStream('stdout', data.stdout);
      if (data.stderr) addStream('stderr', data.stderr);
      if (!data.stdout && !data.stderr) showEmptyOutput('No output was produced before the timeout.');
    } else if (data.status === 'error') {
      setStatus('error', 'Runtime error');
      if (data.stdout) addStream('stdout', data.stdout);
      if (data.stderr) addStream('stderr', data.stderr);
      if (!data.stderr) {
        addNotice(
          'error',
          data.signal
            ? 'Process terminated by signal ' + data.signal + '.'
            : 'Program exited with code ' + data.exitCode + '.'
        );
      }
      if (!data.stdout && !data.stderr) showEmptyOutput('No output was produced.');
    } else {
      setStatus('ok', 'Success');
      if (data.stdout) addStream('stdout', data.stdout);
      if (data.stderr) addStream('stderr', data.stderr);
      if (!data.stdout && !data.stderr) showEmptyOutput('Program finished with no output.');
    }

    if (data.degraded) {
      addNotice(
        'info',
        'Sandbox note: Docker was unavailable, so the code ran in the weaker local fallback engine.'
      );
    }

    var parts = [];
    parts.push('<span>' + data.durationMs + ' ms</span>');
    parts.push(
      '<span class="' +
        (data.exitCode === 0 && !data.timedOut && !data.compileError ? 'meta-ok' : 'meta-bad') +
        '">exit ' +
        (data.exitCode == null ? '—' : data.exitCode) +
        '</span>'
    );
    parts.push('<span>' + data.engine + ' engine</span>');
    if (data.truncated) parts.push('<span>output truncated</span>');
    els.runMeta.innerHTML = parts.join('');
  }

  function renderFailure(message, kind) {
    clearOutput();
    setStatus('error', kind || 'Failed');
    addNotice('error', message);
    showEmptyOutput('Fix the issue and run again.');
  }

  function run() {
    if (state.running) return;
    if (!state.currentId) return;

    var code = getCode();
    if (!code || !code.trim()) {
      toast('Write some code first.');
      return;
    }
    if (code.length > 131072) {
      toast('Code exceeds the 128 KB limit.');
      return;
    }

    state.running = true;
    els.runBtn.disabled = true;
    els.runBtn.classList.add('is-running');
    setStatus('running', 'Running…');
    clearOutput();
    showEmptyOutput('Executing your program…');

    var controller = new AbortController();
    var timer = setTimeout(function () {
      controller.abort();
    }, CLIENT_TIMEOUT_MS);

    fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        language: state.currentId,
        code: code,
        stdin: els.stdin.value,
      }),
      signal: controller.signal,
    })
      .then(function (res) {
        return res.json().catch(function () {
          return null;
        }).then(function (data) {
          if (!res.ok) {
            throw new Error((data && data.error) || 'Request failed (' + res.status + ')');
          }
          if (!data) throw new Error('Empty response from server.');
          return data;
        });
      })
      .then(function (data) {
        renderResult(data);
      })
      .catch(function (err) {
        var msg =
          err && err.name === 'AbortError'
            ? 'Request timed out after 60 seconds.'
            : (err && err.message) || 'Network error.';
        renderFailure(msg, 'Failed');
      })
      .finally(function () {
        clearTimeout(timer);
        state.running = false;
        els.runBtn.disabled = false;
        els.runBtn.classList.remove('is-running');
      });
  }

  /* ----------------------------- health ----------------------------- */

  function initHealth() {
    fetch('/api/health')
      .then(function (r) {
        return r.json();
      })
      .then(function (h) {
        if (h.engine === 'docker') {
          els.engineBadge.parentElement.classList.add('is-docker');
          els.engineText.textContent = 'docker sandbox';
          els.engineBadge.title = 'Code runs inside an isolated Docker container.';
        } else {
          els.engineBadge.parentElement.classList.add('is-local');
          els.engineText.textContent = 'local sandbox';
          els.engineBadge.title =
            'Docker is unavailable - code runs on the host (reduced isolation).';
        }
      })
      .catch(function () {
        els.engineText.textContent = 'offline';
        els.engineBadge.title = 'Cannot reach the server.';
      });
  }

  /* ----------------------------- wiring ----------------------------- */

  function initControls() {
    els.runBtn.addEventListener('click', run);

    els.themeToggle.addEventListener('click', function () {
      applyTheme(state.theme === 'dark' ? 'light' : 'dark');
    });

    els.lang.addEventListener('change', function () {
      selectLanguage(els.lang.value, false);
    });

    els.resetBtn.addEventListener('click', function () {
      var lang = currentLanguage();
      if (!lang) return;
      if (!window.confirm('Reset "' + lang.file + '" to the starter code?')) return;
      delete state.buffers[lang.id];
      saveJSON(STORE_BUFFERS, state.buffers);
      setCode(lang.starter || '');
      toast('Starter code restored.');
    });

    els.clearOutput.addEventListener('click', function () {
      clearOutput();
      setStatus('idle', 'Idle');
    });

    els.clearInput.addEventListener('click', function () {
      els.stdin.value = '';
      saveStdin();
    });

    els.copyOutput.addEventListener('click', function () {
      var text = els.output.innerText;
      if (!text) {
        toast('Nothing to copy.');
        return;
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          function () {
            toast('Output copied.');
          },
          function () {
            toast('Copy failed.');
          }
        );
      } else {
        toast('Clipboard not available.');
      }
    });

    els.stdin.addEventListener('input', saveStdin);

    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'Enter' || e.keyCode === 13)) {
        e.preventDefault();
        run();
      }
    });

    window.addEventListener('beforeunload', saveBuffer);
  }

  function saveStdin() {
    try {
      localStorage.setItem(STORE_STDIN, els.stdin.value);
    } catch (e) {
      /* ignore */
    }
  }

  function initStdin() {
    var stored = null;
    try {
      stored = localStorage.getItem(STORE_STDIN);
    } catch (e) {
      /* ignore */
    }
    if (stored !== null) {
      els.stdin.value = stored;
      return;
    }
    var lang = currentLanguage();
    els.stdin.value = lang && lang.input ? lang.input : '';
  }

  function boot() {
    initTheme();
    initControls();

    fetch('/api/languages')
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        state.languages = data.languages || [];
        if (!state.languages.length) throw new Error('No languages available.');

        var saved = null;
        try {
          saved = localStorage.getItem(STORE_LANG);
        } catch (e) {
          /* ignore */
        }
        var initial =
          saved && state.languages.some(function (l) {
            return l.id === saved;
          })
            ? saved
            : state.languages[0].id;

        state.currentId = initial;
        renderLanguageSelect();
        selectLanguage(initial, true);
        initStdin();
        initMonaco();
        initHealth();
      })
      .catch(function (err) {
        setStatus('error', 'Offline');
        renderFailure('Could not load languages: ' + err.message, 'Failed');
        els.runBtn.disabled = true;
      });
  }

  boot();
})();
