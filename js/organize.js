const { z } = require('zod');

// kept loose because small local models ignore length limits and the SDK
// throws away the whole response if validation fails. clamp it ourselves below.
const Schema = z.object({
  title: z.string().default('').describe('Clean, corrected title of the work'),
  authors: z.array(z.string()).default([]).describe('Full names of this document\'s authors, empty array if unknown'),
  year: z.union([z.string(), z.number()]).optional().describe('Publication year if identifiable'),
  topics: z.array(z.string()).default([]).describe('1-3 broad subject areas, e.g. "Machine Learning", "Ancient History"'),
  tags: z.array(z.string()).default([]).describe('Up to 6 specific keyword tags relevant to THIS document only'),
  summary: z.string().default('').describe('One-sentence summary of what this document is about'),
});

// models sometimes cram a whole comma list into one array item, so split those
// out first, then trim, dedupe and cap
function toCleanList(value, max) {
  const seen = new Set();
  const out = [];
  for (const raw of value || []) {
    for (const piece of String(raw).split(/[,;]/)) {
      const s = piece.trim();
      if (!s || seen.has(s.toLowerCase())) continue;
      seen.add(s.toLowerCase());
      out.push(s);
      if (out.length >= max) return out;
    }
  }
  return out;
}

// if a suggested tag is basically one the library already has, use the existing
// spelling instead of a near-duplicate. matching is done here, locally — the
// library's tag list is never sent to the AI model.
function reuseExistingTags(tags, existingTags) {
  const norm = s => s.toLowerCase().replace(/[\s_-]+/g, '');
  const known = new Map(existingTags.map(t => [norm(t), t]));
  return tags.map(t => known.get(norm(t)) || t);
}

function clamp(object) {
  return {
    title: (object.title || '').trim(),
    authors: toCleanList(object.authors, 10),
    year: object.year != null ? String(object.year).trim() : undefined,
    topics: toCleanList(object.topics, 3),
    tags: toCleanList(object.tags, 6),
    summary: (object.summary || '').trim().slice(0, 280),
  };
}

function buildPrompt(extracted) {
  return `You are cataloguing ONE document in a personal library. Read the extracted text below and fill in its metadata.

The file is currently named "${extracted.fileName || 'unknown'}". That is only a file name (often lowercased, with underscores, or a publisher code) — do NOT use it as the title. Find the document's real title as it is actually printed in the text.

Embedded title (if any): ${extracted.embeddedTitle || 'none'}
Embedded author (if any): ${extracted.embeddedAuthor || 'none'}

Extracted text:
"""
${extracted.text}
"""

Fill in every field:
- title: the document's real title, exactly as printed on its title page or cover, in its original language, properly capitalised. Never return the file name or a reworded version of it.
- authors: the names of the people who wrote THIS document. Look for phrases like "written by", "by X, Y and Z", "edited by", or names near the title. Example: from "written by Mark F. Bear, Barry W. Connors, and Michael A. Paradiso" the authors are ["Mark F. Bear", "Barry W. Connors", "Michael A. Paradiso"].
- year: publication year, if identifiable.
- topics: 1 to 3 broad subject areas.
- tags: AT MOST 6 specific keywords drawn only from THIS document's own content. Do not add unrelated subjects.
- summary: one sentence saying what this document is about.`;
}

// Pull a JSON object out of a plain-text model response (may be wrapped in
// markdown fences or surrounded by prose).
function parseJsonLoosely(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new Error('AI response contained no JSON object.');
  }
  return JSON.parse(text.slice(start, end + 1));
}

async function organize(extracted, existingTags) {
  const ai = eagle.extraModule.ai;
  const defaultModel = ai.getDefaultModel('chat');

  if (!defaultModel) {
    throw new Error('NO_AI_MODEL_CONFIGURED');
  }

  const model = ai.getModel(defaultModel);
  const prompt = buildPrompt(extracted);
  const { generateObject, generateText } = ai;

  let result;
  // try structured output first; a lot of small Ollama models don't support
  // it, so fall back to plain text and parse the json ourselves
  try {
    const { object } = await generateObject({ model, schema: Schema, prompt });
    result = clamp(object);
  } catch (structuredErr) {
    eagle.log.warn(`generateObject failed (${structuredErr.message}); falling back to text mode`);
    const { text } = await generateText({
      model,
      prompt: `${prompt}

Respond with ONLY a JSON object (no markdown, no explanations) in exactly this shape:
{"title": "...", "authors": ["..."], "year": "...", "topics": ["..."], "tags": ["..."], "summary": "..."}`,
    });
    const parsed = Schema.safeParse(parseJsonLoosely(text));
    if (!parsed.success) {
      throw new Error('AI returned JSON in an unexpected structure. Try Retry, or a larger model.');
    }
    result = clamp(parsed.data);
  }

  // reuse the library's own tag spellings, matched locally
  result.tags = toCleanList(reuseExistingTags(result.tags, existingTags), 6);
  return result;
}

module.exports = { organize };
