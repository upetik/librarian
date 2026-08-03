const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const MAX_CHARS_FOR_AI = 3500;
// scan a good chunk of pages for a text layer before giving up. front matter
// (cover, title page) is often image-only, so looking at only the first few
// pages would wrongly flag a normal book as "scanned".
const TEXT_SCAN_PAGES = 15;
const OCR_PAGES = 5; // OCR is slow, so do fewer pages when it's actually needed
const MIN_TEXT_LEN = 50; // below this across all scanned pages, treat as scanned

let pdfjsLib = null;

// inside Eagle we're in a browser context and pdf.js wants file:// URLs;
// node (used for local testing) is fine with plain paths
const inBrowser = typeof window !== 'undefined';
const asUrl = p => (inBrowser ? pathToFileURL(p).href : p);

function getPdfjs() {
  if (!pdfjsLib) {
    pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      asUrl(require.resolve('pdfjs-dist/legacy/build/pdf.worker.js'));
  }
  return pdfjsLib;
}

async function openPdf(filePath) {
  const pdfjsRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));
  return getPdfjs().getDocument({
    data: new Uint8Array(fs.readFileSync(filePath)),
    isEvalSupported: false, // CVE-2024-4367
    cMapUrl: asUrl(path.join(pdfjsRoot, 'cmaps')) + '/',
    cMapPacked: true,
    standardFontDataUrl: asUrl(path.join(pdfjsRoot, 'standard_fonts')) + '/',
  }).promise;
}

async function extractPdf(filePath) {
  const t0 = Date.now();
  const doc = await openPdf(filePath);
  const tOpen = Date.now();

  try {
    const metadata = await doc.getMetadata().catch(() => null);
    const info = metadata?.info || {};

    let text = '';
    let pagesRead = 0;
    const pageCount = Math.min(doc.numPages, TEXT_SCAN_PAGES);
    for (let i = 1; i <= pageCount; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map(it => it.str).join(' ') + '\n';
      pagesRead = i;
      if (text.length >= MAX_CHARS_FOR_AI) break;
    }

    eagle.log.info(`Librarian PDF: ${text.trim().length} chars from ${pagesRead} pages | open ${tOpen - t0}ms, read ${Date.now() - tOpen}ms`);
    if (text.trim().length >= MIN_TEXT_LEN) {
      return {
        text: text.slice(0, MAX_CHARS_FOR_AI),
        embeddedTitle: info.Title || null,
        embeddedAuthor: info.Author || null,
        source: 'text-layer',
      };
    }

    // nothing readable, probably a scan, so OCR the pages
    return await ocrPdf(doc);
  } finally {
    await doc.destroy();
  }
}

async function ocrPdf(doc) {
  const tessRoot = path.dirname(require.resolve('tesseract.js/package.json'));

  // Eagle runs as Electron, so the default tesseract build spawns a Node
  // worker_thread, which Chromium blocks (SharedArrayBuffer needs cross-origin
  // isolation) and it hangs forever. Load the browser build instead so it uses
  // a plain Web Worker with the single-threaded core.
  const { createWorker } = require(path.join(tessRoot, 'dist', 'tesseract.min.js'));

  // everything the OCR engine needs is bundled in the plugin, so nothing is
  // fetched from the network. english only.
  const coreRoot = path.dirname(require.resolve('tesseract.js-core/package.json'));
  const ocrOptions = {
    workerPath: asUrl(path.join(tessRoot, 'dist', 'worker.min.js')),
    corePath: asUrl(coreRoot),
    langPath: asUrl(path.join(__dirname, '..', 'tessdata')),
    workerBlobURL: false, // load the worker straight from the file instead of fetching it
    gzip: true,
  };
  eagle.log.info(`Librarian OCR (browser build) starting: ${JSON.stringify(ocrOptions)}`);

  const pageCount = Math.min(doc.numPages, OCR_PAGES);
  const worker = await createWorker('eng', 1, ocrOptions);

  let combinedText = '';
  try {
    for (let i = 1; i <= pageCount; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: 2.0 });
      // use the window's own canvas so this works on every OS with no native binary
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;

      const { data: { text } } = await worker.recognize(canvas);
      combinedText += text + '\n';
      if (combinedText.length >= MAX_CHARS_FOR_AI) break;
    }
  } finally {
    await worker.terminate();
  }

  return {
    text: combinedText.slice(0, MAX_CHARS_FOR_AI),
    embeddedTitle: null,
    embeddedAuthor: null,
    source: combinedText.trim().length >= MIN_TEXT_LEN ? 'ocr' : 'empty',
  };
}

async function extractEpub(filePath) {
  const { EPub } = require('epub2');
  const epub = await EPub.createAsync(filePath);

  const firstChapter = (epub.flow || [])[0];
  let chapterText = '';
  if (firstChapter) {
    const html = await epub.getChapterAsync(firstChapter.id);
    chapterText = String(html).replace(/<[^>]+>/g, ' '); // drop the html tags
  }

  const meta = epub.metadata || {};
  return {
    text: chapterText.slice(0, MAX_CHARS_FOR_AI),
    embeddedTitle: meta.title || null,
    embeddedAuthor: meta.creator || null,
    source: 'epub-metadata',
  };
}

async function extract(item) {
  const ext = item.ext.toLowerCase();
  let result;
  if (ext === 'pdf') result = await extractPdf(item.filePath);
  else if (ext === 'epub') result = await extractEpub(item.filePath);
  else throw new Error(`Unsupported file type: .${ext}`);
  result.fileName = item.name; // used to tell the AI what NOT to use as the title
  return result;
}

module.exports = { extract };
