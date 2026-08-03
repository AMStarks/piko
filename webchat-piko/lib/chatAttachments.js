/**
 * Ingest chat attachments: save under tenant data and build review context for Piko.
 */
const fs = require('fs');
const path = require('path');
const { saveUpload } = require('./pikoUpload');

const MAX_FILES = Math.max(1, Number(process.env.PIKO_CHAT_ATTACH_MAX || 5));
const TEXT_EXTS = new Set(['.txt', '.md', '.csv', '.json', '.log', '.tsv', '.xml', '.html', '.htm']);
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.heic']);
const PDF_EXTS = new Set(['.pdf']);

function isAttachmentList(value) {
  return Array.isArray(value) && value.length > 0;
}

async function readTextExcerpt(filePath, maxLen = 20000) {
  const raw = fs.readFileSync(filePath);
  // Skip obvious binary
  if (raw.includes(0)) return null;
  return raw.toString('utf8').slice(0, maxLen);
}

/**
 * @param {string} message
 * @param {Array<{filename?:string,name?:string,content_base64?:string,base64?:string}>} attachments
 * @returns {Promise<{ message: string, saved: Array<object> }>}
 */
async function enrichMessageWithAttachments(message, attachments) {
  const list = Array.isArray(attachments) ? attachments.slice(0, MAX_FILES) : [];
  if (!list.length) {
    return { message: String(message || '').trim(), saved: [] };
  }

  const parts = [];
  const saved = [];
  for (const att of list) {
    const filename = att.filename || att.name;
    const b64 = att.content_base64 || att.base64;
    if (!filename || !b64) continue;
    const out = saveUpload({
      filename,
      content_base64: b64,
      subdir: 'chat-inbox',
    });
    saved.push(out);
    const ext = path.extname(out.filename || '').toLowerCase();
    let review = '';
    try {
      if (PDF_EXTS.has(ext)) {
        const { parseLocalDocument } = require('./documentParser');
        review = await parseLocalDocument(out.path);
      } else if (TEXT_EXTS.has(ext)) {
        const text = await readTextExcerpt(out.path);
        review = text != null
          ? `Text content:\n${text}`
          : `(Could not read as text. Path: ${out.path})`;
      } else if (IMAGE_EXTS.has(ext)) {
        review = `Image saved for review.\nPath: ${out.path}\nSize: ${out.size} bytes.\nDescribe what you see or extract useful detail for the user. If a culture/scribe tool is available, you may suggest using it.`;
      } else {
        review = `File saved at ${out.path} (${out.size} bytes). Summarize what you can from the filename/path and ask if the user wants a specific analysis.`;
      }
    } catch (e) {
      review = `Saved at ${out.path}, but review extract failed: ${e.message || e}`;
    }
    parts.push(`--- Attached: ${out.filename} (${out.size} bytes) ---\n${review}`);
  }

  const userText = String(message || '').trim() || 'Please review the attached file(s).';
  if (!parts.length) return { message: userText, saved };

  return {
    message: `${userText}\n\n[Attachments for your review]\n${parts.join('\n\n')}`,
    saved,
  };
}

module.exports = {
  enrichMessageWithAttachments,
  isAttachmentList,
  MAX_FILES,
};
