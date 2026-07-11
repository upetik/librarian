# Librarian

OCR and AI-powered title, author and tag organizer for your PDFs and EPUBs.

*(Suggested Plugin Center description, 78 chars — copy the line above into the submission form.)*

---

## What it does (single purpose)

Librarian reads the PDF/EPUB files you select in your Eagle library, extracts
their text (with OCR fallback for scanned PDFs), and uses your configured AI
model to suggest a clean **title, authors, topics, tags and a one-sentence
summary**. Nothing is written to your library until you review the suggestions
and click **Save**.

## Requirements

1. **Eagle "AI Models" plugin** (declared as a dependency; Eagle offers to
   install it automatically on first run).
2. **A configured default Language Model** in
   *Eagle → Preferences → AI Models*. Any supported provider works:
   - **Free / local**: [Ollama](https://ollama.com) or LM Studio running on
     the user's machine (no API key, no cost).
   - **Cloud**: OpenAI, Google Gemini, DeepSeek or Qwen with the user's own
     API key.

## How to test (for review staff)

1. **Set up the AI model.** Librarian uses Eagle's own **AI Models** plugin —
   no separate account or key is built into Librarian. Open
   *Eagle → Preferences → AI Models* and configure any Language Model:
   - **Free, fully local (recommended):** install [Ollama](https://ollama.com),
     run `ollama pull qwen2.5:3b` in a terminal, then in Eagle add Ollama as a
     provider with API base `http://localhost:11434/v1` and set `qwen2.5:3b`
     as the default Language Model.
   - **Cloud:** OpenAI, Gemini, DeepSeek or Qwen with your own key.
2. **Select the files to organise.** In your Eagle library, click a **PDF or
   EPUB** file to select it. You can select several at once (Cmd/Ctrl-click or
   Shift-click) to process them as a batch.
3. **Open Librarian** from the plugin panel — it reads whatever you selected in
   step 2.
4. Each selected file shows a processing status, then editable fields (Title,
   Authors, Topics, Tags, Summary) filled in by the AI. Edit anything you like.
5. Click **Save** (one file — the window closes after saving) or **Save All**
   (a batch; use **Skip** to leave a file out).
6. Verify in Eagle: the item's name, tags and annotation were updated.

Edge cases that are handled and can be tested:
- No PDF/EPUB selected → friendly empty-state message.
- AI Models plugin missing or no default model → warning with a
  "Open AI settings" button (`ai.open()`).
- Scanned/image-only PDF → OCR fallback (slower; capped at the first 8 pages).
- Corrupt file or unreadable scan → per-file error with a Retry button; other
  files in the batch are unaffected.

## Privacy & data flow (disclosure)

- The plugin reads **only the files the user explicitly selects**.
- Up to the first ~6,000 characters of extracted text are sent **only to the
  AI provider the user configured themselves** in Eagle's AI Models
  preferences (which may be a fully local model, in which case nothing leaves
  the machine). Transport is handled entirely by Eagle's AI SDK.
- The plugin makes **no other network requests**, stores nothing outside the
  Eagle library, and collects no personal information.
- Library changes (name, tags, annotation) happen **only after the user
  clicks Save**.

## Technical notes

- Text extraction: `pdfjs-dist` (text layer) with `tesseract.js` +
  `@napi-rs/canvas` OCR fallback; `epub2` for EPUB metadata/text.
- AI calls: Eagle AI SDK `generateObject` with a `zod` schema, with a
  plain-text JSON fallback for models without structured-output support.
- OCR and AI processing are capped (first 8 pages, 2 files concurrently) to
  keep the plugin responsive.
- Platforms: developed and tested on macOS. All native dependencies ship
  prebuilt binaries for both macOS and Windows (no compilation at install
  time). The bundled OCR engine makes the package large (~150 MB installed).

## Support

- Contact: https://github.com/upetik/librarian/issues
