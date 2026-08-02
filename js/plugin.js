const path = require('path');
const { fileURLToPath } = require('url');

// require() here resolves relative to Eagle's own folder, not ours, so build
// absolute paths from the window url (plugin.path isn't ready this early)
const pluginRoot = path.dirname(fileURLToPath(window.location.href));

const { extract } = require(path.join(pluginRoot, 'js', 'extract.js'));
const { organize } = require(path.join(pluginRoot, 'js', 'organize.js'));
const { renderReview, showError, showEmptyState } = require(path.join(pluginRoot, 'js', 'ui.js'));

const SUPPORTED_EXT = ['pdf', 'epub'];

// onPluginRun can fire before onPluginCreate, but the eagle.* APIs aren't
// ready until create runs, so wait for it
const pluginReady = new Promise(resolve => {
  eagle.onPluginCreate(plugin => {
    eagle.log.info('Librarian plugin created');
    resolve(plugin);
  });
});

async function run() {
  try {
    await pluginReady;

    const selected = await eagle.item.getSelected();
    const items = selected.filter(i => SUPPORTED_EXT.includes(i.ext.toLowerCase()));

    if (items.length === 0) {
      showEmptyState('Select one or more PDF or EPUB files in your library, then run Librarian ✿ again.');
      return;
    }

    const ai = eagle.extraModule && eagle.extraModule.ai;
    if (!ai) {
      showError({
        icon: 'warning',
        title: 'This plugin needs Eagle\'s "AI Models" plugin to work.',
        lines: [
          'To set it up: open the Plugin Center, search for "AI Models" and install it.',
          'Then go to Eagle → Preferences → AI Models to configure a provider.',
          'Reopen Librarian afterwards. If it doesn\'t appear in the Plugin Center, update Eagle first :)',
        ],
      });
      return;
    }
    if (!ai.getDefaultModel('chat')) {
      showError({
        icon: 'warning',
        title: 'No default Language Model set.',
        lines: ['Configure one in Eagle\'s AI Models settings, then try again.'],
      }, [
        { label: 'Open AI settings', icon: 'settings', onClick: () => ai.open() },
        { label: 'Try again', icon: 'retry', onClick: () => { ai.reload(); run(); } },
      ]);
      return;
    }

    const existingTags = (await eagle.tag.get()).sort((a, b) => b.count - a.count).map(t => t.name);

    await renderReview(items, async (item) => {
      const extracted = await extract(item);
      if (extracted.source === 'empty') {
        throw new Error('No readable text found (image quality too low for OCR).');
      }
      return organize(extracted, existingTags);
    });
  } catch (err) {
    eagle.log.error(err.message);
    showError(`Unexpected error: ${err.message}`);
  }
}

eagle.onPluginRun(run);
