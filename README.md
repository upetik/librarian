# Librarian ✿

OCR and AI-powered title, author and tag organizer for Eagle's PDFs & EPUBs

## What it does

Librarian ✿ reads the PDF & EPUB files you select in your Eagle library, extracts their text (with OCR fallback for scanned PDFs), and uses your configured AI model to suggest a clean title, authors, topics, tags and a one-sentence summary. Nothing is written to the library until you review the suggestions and click Save.

## Requirements

1. Eagle's **AI Models** plugin (declared as a dependency; Eagle offers to install it on first run).
2. A default Language Model configured in Eagle → Preferences → AI Models. Any supported provider works:
   - **Free / local:** [Ollama](https://ollama.com/) or LM Studio on your machine (no API key, no cost).
   - **Cloud:** OpenAI, Google Gemini, DeepSeek or Qwen with your own API key.

## How to use

1. Select one or more PDF or EPUB files in your Eagle library (Cmd/Ctrl-click or Shift-click for several).
2. Open Librarian from the plugin panel — it reads whatever you selected.
3. Each file shows a processing status, then editable fields (Title, Authors, Topics, Tags, Summary) filled in by the AI. Edit anything you like.
4. Click **Save** (one file — the window closes after saving) or **Save All** (a batch; use Skip to leave a file out).

## Processing limits

- PDFs: only the first **8 pages** are read; about **6,000 characters** of extracted text go into the AI prompt.
- EPUBs: only the first chapter is read.
- Scanned/image-only PDFs use OCR fallback, which **currently supports English documents only**.

## Privacy & data flow

- Librarian reads the content of **only the files you select**.
- The AI prompt contains the document's **extracted text, plus its embedded title and author** (when present). If you chose a **cloud** model, this information is sent to that provider through Eagle's AI SDK. If you chose a **local** model (Ollama / LM Studio), nothing leaves your machine.
- To reuse tags you already have, Librarian reads your library's existing tag names and matches them **locally, on your machine**. This tag list is **never transmitted** to any AI provider.
- OCR runs fully **offline**: the OCR engine and the English language data are bundled in the plugin — no files are downloaded at runtime.
- Library changes (name, tags, annotation) happen **only after you click Save**, and existing tags/notes on an item are kept, not overwritten.

## Technical notes

- Text extraction: `pdfjs-dist` (text layer) with `tesseract.js` OCR fallback rendered on the browser canvas; `epub2` for EPUB metadata/text.
- AI calls: Eagle AI SDK `generateObject` with a `zod` schema, plus a plain-text JSON fallback for models without structured output.
- Processing is capped (first 8 pages, 2 files at a time) to stay responsive.
- Cross-platform: no native binaries — works on macOS and Windows. Bundling the OCR engine + English language data makes the package fairly large.

## Support

✿ Contact: https://github.com/upetik/librarian/issues
