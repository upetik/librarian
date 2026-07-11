const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const MAX_PAGES = 8;           // cap for PDF text/OCR — title, abstract, TOC live here
const MAX_CHARS_FOR_AI = 6000; // cap prompt size sent to the AI model
const MIN_TEXT_LEN = 50;       // below this, treat PDF as scanned/image-only

let pdfjsLib = null;

// Eagle's plugin window looks like a browser to pdf.js, so assets are loaded
// by URL; in plain Node (tests) they're read from filesystem paths instead.
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
    isEvalSupported: false, // mitigates CVE-2024-4367 in pdfjs-dist 3.x
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

    // No usable text layer — fall back to rasterizing + OCR-ing the first pages.
    return await ocrPdf(doc);
  } finally {
    await doc.destroy();
  }
}

async function ocrPdf(doc) {
  const { createCanvas } = require('@napi-rs/canvas');
  const { createWorker } = require('tesseract.js');

  const pageCount = Math.min(doc.numPages, MAX_PAGES);
  const worker = await createWorker('eng');

  let combinedText = '';
  try {
    for (let i = 1; i <= pageCount; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: 2.0 });
      const canvas = createCanvas(viewport.width, viewport.height);
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;

      const { data: { text } } = await worker.recognize(canvas.toBuffer('image/png'));
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
          resolve(String(html).replace(/<[^>]+>/g, ' ')); // strip tags, keep it simple
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
