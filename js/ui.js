const CONCURRENCY = 2; // OCR is heavy, don't run too many at once

// --- inline SVG icons (Lucide, stroke = currentColor) -----------------------

const ICONS = {
  logo: '<path d="M12 7v14"/><path d="M16 12h2"/><path d="M16 8h2"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/><path d="M6 12h2"/><path d="M6 8h2"/>',
  retry: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
  skip: '<path d="M17 12H3"/><path d="m11 18 6-6-6-6"/><path d="M21 5v14"/>',
  include: '<path d="M21.801 10A10 10 0 1 1 17 3.335"/><path d="m9 11 3 3L22 4"/>',
  save: '<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/>',
  loader: '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
  warning: '<path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  alert: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
  sun: '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>',
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  settings: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
};

function iconSvg(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
}

function icon(name) {
  const span = document.createElement('span');
  span.className = 'icon';
  span.innerHTML = iconSvg(name);
  return span;
}

function setButton(btn, iconName, label) {
  btn.innerHTML = `<span class="icon">${iconSvg(iconName)}</span><span>${label}</span>`;
}

// --- theme: follow Eagle by default, manual toggle overrides ----------------

const LIGHT_THEMES = ['LIGHT', 'LIGHTGRAY'];
const THEME_KEY = 'librarian-theme';

function eagleMode() {
  try {
    return LIGHT_THEMES.includes(String(eagle.app.theme).toUpperCase()) ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

// The toggle button keeps a fixed sun-moon icon (inlined in index.html).
function applyMode(mode) {
  document.documentElement.dataset.theme = mode;
}

function initTheme() {
  applyMode(localStorage.getItem(THEME_KEY) || eagleMode());

  document.getElementById('theme-toggle').onclick = () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, next);
    applyMode(next);
  };

  // Follow Eagle's theme live, unless the user has manually overridden it.
  eagle.onThemeChanged(() => {
    if (!localStorage.getItem(THEME_KEY)) applyMode(eagleMode());
  });
}

initTheme();

// --- shared helpers --------------------------------------------------------

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  children.forEach(c => node.appendChild(c));
  return node;
}

function field(labelText, input) {
  return el('div', { className: 'field' }, [
    el('label', { textContent: labelText }),
    input,
  ]);
}

// grow a textarea to fit its content so there's no scrollbar
function autoGrow(area) {
  area.style.height = 'auto';
  area.style.height = area.scrollHeight + 'px';
}

// never let one item spin forever (a stuck OCR worker, an unresponsive model…)
function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function setProgress(text, busy = false) {
  const label = document.getElementById('progress-label');
  label.textContent = text;
  label.classList.toggle('progress-busy', busy);
  document.getElementById('progress-spinner').hidden = !busy;
}

function showEmptyState(message) {
  document.getElementById('error-banner').hidden = true;
  document.getElementById('review-list').innerHTML = '';
  document.getElementById('actions').hidden = true;
  setProgress('');
  document.getElementById('empty-message').textContent = message;
  document.getElementById('empty-state').hidden = false;
}

function showError(message, actions = []) {
  document.getElementById('empty-state').hidden = true;
  document.getElementById('actions').hidden = true;
  document.getElementById('review-list').innerHTML = '';
  setProgress('');
  const banner = document.getElementById('error-banner');
  banner.innerHTML = '';
  if (typeof message === 'string') {
    banner.appendChild(el('div', { textContent: message }));
  } else {
    if (message.title) {
      const title = el('div', { className: 'banner-title' });
      if (message.icon) title.appendChild(icon(message.icon));
      title.appendChild(el('span', { textContent: message.title }));
      banner.appendChild(title);
    }
    (message.lines || []).forEach(line => banner.appendChild(el('div', { className: 'banner-line', textContent: line })));
  }
  if (actions.length) {
    banner.appendChild(el('div', { className: 'banner-actions' }, actions.map(a => {
      const btn = el('button');
      setButton(btn, a.icon || 'retry', a.label);
      btn.onclick = a.onClick;
      return btn;
    })));
  }
  banner.hidden = false;
}

// --- review list -----------------------------------------------------------

function buildRow(item, single) {
  const titleInput = el('input', { type: 'text', value: item.name });
  const authorsInput = el('input', { type: 'text' });
  const topicsInput = el('input', { type: 'text' });
  const tagsInput = el('input', { type: 'text' });
  const summaryInput = el('textarea', { rows: 2 });
  summaryInput.addEventListener('input', () => autoGrow(summaryInput));

  const spinner = el('span', { className: 'spinner icon' });
  spinner.innerHTML = iconSvg('loader');
  const statusIcon = el('span', { className: 'icon status-icon', hidden: true });
  const statusText = el('span', {}, [document.createTextNode('Processing…')]);
  const status = el('div', { className: 'row-status' }, [spinner, statusIcon, statusText]);

  const retryBtn = el('button', { hidden: true });
  setButton(retryBtn, 'retry', 'Retry');
  const skipBtn = el('button', { hidden: single, className: 'btn-skip' });
  setButton(skipBtn, 'skip', 'Skip');

  const fields = el('div', { className: 'row-fields', hidden: true }, [
    field('Title', titleInput),
    field('Authors', authorsInput),
    field('Topics', topicsInput),
    field('Tags', tagsInput),
    field('Summary', summaryInput),
  ]);

  const row = el('div', { className: 'review-row' }, [
    el('div', { className: 'row-name', textContent: item.name }),
    status,
    fields,
    el('div', { className: 'row-actions' }, [retryBtn, skipBtn]),
  ]);

  const setStatus = (text, state) => {
    statusText.textContent = text;
    spinner.hidden = state !== 'busy';
    statusIcon.hidden = state === 'busy';
    if (state === 'ok') statusIcon.innerHTML = iconSvg('check');
    if (state === 'error') statusIcon.innerHTML = iconSvg('alert');
  };

  return { row, fields, setStatus, titleInput, authorsInput, topicsInput, tagsInput, summaryInput, retryBtn, skipBtn };
}

async function runWithConcurrency(items, limit, worker) {
  let cursor = 0;
  async function next() {
    if (cursor >= items.length) return;
    const i = cursor++;
    await worker(items[i], i);
    await next();
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, next));
}

async function renderReview(items, processItem) {
  document.getElementById('empty-state').hidden = true;
  document.getElementById('error-banner').hidden = true;
  const list = document.getElementById('review-list');
  const actions = document.getElementById('actions');
  list.innerHTML = '';
  actions.hidden = false;

  const single = items.length === 1;
  const rows = new Map(); // item -> row parts
  let settled = 0;

  const updateProgress = () => {
    const busy = settled < items.length;
    setProgress(busy
      ? `Processing ${settled + 1} of ${items.length}…`
      : `Done, review and save`, busy);
  };
  updateProgress();

  items.forEach(item => {
    const parts = buildRow(item, single);
    parts.skipped = false;
    rows.set(item, parts);
    list.appendChild(parts.row);

    parts.skipBtn.onclick = () => {
      parts.skipped = !parts.skipped;
      parts.row.classList.toggle('skipped', parts.skipped);
      setButton(parts.skipBtn, parts.skipped ? 'include' : 'skip', parts.skipped ? 'Include' : 'Skip');
    };
  });

  async function processOne(item, isRetry) {
    const parts = rows.get(item);
    parts.setStatus('Processing…', 'busy');
    parts.retryBtn.hidden = true;
    parts.fields.hidden = true;
    try {
      const result = await withTimeout(
        processItem(item, (stage) => parts.setStatus(stage, 'busy')),
        90000,
        'Timed out. If this is a scanned PDF, OCR may have failed to start.'
      );
      parts.titleInput.value = result.title || item.name;
      parts.authorsInput.value = (result.authors || []).join(', ');
      parts.topicsInput.value = (result.topics || []).join(', ');
      parts.tagsInput.value = (result.tags || []).join(', ');
      parts.summaryInput.value = result.year
        ? `(${result.year}) ${result.summary || ''}`
        : (result.summary || '');
      parts.setStatus('Ready for review', 'ok');
      parts.fields.hidden = false;
      autoGrow(parts.summaryInput); // size the box to the text, no scrollbar
    } catch (err) {
      parts.setStatus(`Failed: ${err.message}`, 'error');
      parts.retryBtn.hidden = false;
      parts.retryBtn.onclick = () => processOne(item, true);
    } finally {
      if (!isRetry) {
        settled++;
        updateProgress();
      }
    }
  }

  await runWithConcurrency(items, CONCURRENCY, item => processOne(item, false));

  const saveAllBtn = document.getElementById('save-all');
  setButton(saveAllBtn, 'save', single ? 'Save' : 'Save all');

  saveAllBtn.onclick = async () => {
    saveAllBtn.disabled = true;
    setButton(saveAllBtn, 'save', 'Saving…');
    for (const [item, parts] of rows) {
      if (parts.skipped || parts.fields.hidden) continue; // skipped or never succeeded
      const authors = parts.authorsInput.value.split(',').map(s => s.trim()).filter(Boolean);
      const topics = parts.topicsInput.value.split(',').map(s => s.trim()).filter(Boolean);
      const tags = parts.tagsInput.value.split(',').map(s => s.trim()).filter(Boolean);
      const summary = parts.summaryInput.value.trim();

      item.name = parts.titleInput.value.trim() || item.name;

      // keep whatever tags the item already had, add the new ones on top
      const seen = new Set();
      item.tags = [...(item.tags || []), ...topics, ...tags].filter(t => {
        const key = t.toLowerCase();
        if (!t || seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      // don't wipe an existing note the user wrote themselves
      const note = [authors.join(', '), summary].filter(Boolean).join('\n\n');
      const existing = (item.annotation || '').trim();
      if (!existing) {
        item.annotation = note;
      } else if (note && !(summary && existing.includes(summary))) {
        item.annotation = `${note}\n\n${existing}`;
      }

      await item.save();
      parts.setStatus('Saved', 'ok');
    }
    saveAllBtn.disabled = false;
    setButton(saveAllBtn, 'save', single ? 'Save' : 'Save all');
    setProgress('Saved');
    if (single) {
      setTimeout(() => window.close(), 500);
    }
  };
}

module.exports = { renderReview, showError, showEmptyState };
