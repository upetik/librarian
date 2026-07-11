const { z } = require('zod');

// Lenient on purpose: small local models (e.g. qwen2.5:3b via Ollama) don't
// reliably respect array-length or string-length caps, and Eagle's AI SDK
// rejects the whole response when validation fails. Accept what comes back
// and clamp in code instead.
const Schema = z.object({
  title: z.string().default('').describe('Clean, corrected title of the work'),
  authors: z.array(z.string()).default([]).describe('Full names of this document\'s authors, empty array if unknown'),
  year: z.union([z.string(), z.number()]).optional().describe('Publication year if identifiable'),
  topics: z.array(z.string()).default([]).describe('1-3 broad subject areas, e.g. "Machine Learning", "Ancient History"'),
  tags: z.array(z.string()).default([]).describe('Up to 6 specific keyword tags relevant to THIS document only'),
  summary: z.string().default('').describe('One-sentence summary of what this document is about'),
});

// Models sometimes return a whole comma-joined list as a single array element —
// split first, then trim, dedupe (case-insensitive), and cap.
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

function buildPrompt(extracted, existingTags) {
  const tagList = existingTags.slice(0, 50).join(', ');

  return `You are cataloguing ONE document in a personal library. Read the extracted text below and fill in its metadata.

Embedded title (if any): ${extracted.embeddedTitle || 'none'}
Embedded author (if any): ${extracted.embeddedAuthor || 'none'}

Extracted text:
"""
${extracted.text}
"""

Fill in every field:
- title: the document's real title, cleaned up.
- authors: the names of the people who wrote THIS document. Look carefully for phrases like "written by", "by X, Y and Z", "edited by", or names listed on the title page / near the title, and extract each full name. Example: from "written by Mark F. Bear, Barry W. Connors, and Michael A. Paradiso" the authors are ["Mark F. Bear", "Barry W. Connors", "Michael A. Paradiso"].
- year: publication year, if identifiable.
- topics: 1 to 3 broad subject areas.
- tags: AT MOST 6 keywords that describe THIS document specifically. ${tagList ? `Prefer reusing tags from this list when (and only when) they genuinely apply to this document: ${tagList}. Never copy tags that don't apply.` : 'Invent concise, reusable keywords.'}
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
  const prompt = buildPrompt(extracted, existingTags);
  const { generateObject, generateText } = ai;

  // First choice: structured output. Some providers/models (notably small
  // Ollama models) don't support it — fall back to plain text + manual parse.
  try {
    const { object } = await generateObject({ model, schema: Schema, prompt });
    return clamp(object);
  } catch (structuredErr) {
    eagle.log.warn(`generateObject failed (${structuredErr.message}); falling back to text mode`);
  }

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
  return clamp(parsed.data);
}

module.exports = { organize };
