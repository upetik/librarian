const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

// title, abstract and TOC live in the first few pages, so no need to read more
const MAX_PAGES = 8;
const MAX_CHARS_FOR_AI = 6000;
const MIN_TEXT_LEN = 50; // less than this and we assume it's a scanned PDF

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
  const doc = await openPdf(filePath);

  try {
    const metadata = await doc.getMetadata().catch(() => null);
    const info = metadata?.info || {};

    let text = '';
    const pageCount = Math.min(doc.numPages, MAX_PAGES);
    for (let i = 1; i <= pageCount; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map(it => it.str).join(' ') + '\n';
      if (text.length >= MAX_CHARS_FOR_AI) break;
    }

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
  const { createWorker } = require('tesseract.js');

  const pageCount = Math.min(doc.numPages, MAX_PAGES);
  const worker = await createWorker('eng');

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
  const EPub = require('epub2');

  const epub = await new Promise((resolve, reject) => {
    const e = new EPub(filePath);
    e.on('error', reject);
    e.on('end', () => resolve(e));
    e.parse();
  });

  const firstChapter = epub.flow[0];
  const chapterText = firstChapter
    ? await new Promise((resolve, reject) => {
        epub.getChapter(firstChapter.id, (err, html) => {
          if (err) return reject(err);
          resolve(String(html).replace(/<[^>]+>/g, ' ')); // drop the html tags
        });
      })
    : '';

  return {
    text: chapterText.slice(0, MAX_CHARS_FOR_AI),
    embeddedTitle: epub.metadata.title || null,
    embeddedAuthor: epub.metadata.creator || null,
    source: 'epub-metadata',
  };
}

async function extract(item) {
  const ext = item.ext.toLowerCase();
  if (ext === 'pdf') return extractPdf(item.filePath);
  if (ext === 'epub') return extractEpub(item.filePath);
  throw new Error(`Unsupported file type: .${ext}`);
}

module.exports = { extract };
