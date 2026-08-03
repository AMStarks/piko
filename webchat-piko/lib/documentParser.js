/**
 * Document parser — extracts text from local PDFs. Use for supplier catalogs, reports, etc.
 */
const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');

const MAX_TEXT_LEN = 20000;

async function parseLocalDocument(filePath) {
  try {
    const resolved = path.isAbsolute(filePath) ? filePath : path.join(__dirname, '..', filePath);
    if (!fs.existsSync(resolved)) {
      return `Error: File not found at ${resolved}`;
    }

    const dataBuffer = fs.readFileSync(resolved);
    const data = await pdf(dataBuffer);

    let text = (data.text || '').trim();
    if (text.length > MAX_TEXT_LEN) {
      text = text.substring(0, MAX_TEXT_LEN) + '\n...[TRUNCATED]';
    }

    return `Document parsed successfully. Pages: ${data.numpages || 0}\n\nContent:\n${text || '(no extractable text)'}`;
  } catch (error) {
    console.error('[DOC PARSER ERROR]', error.message);
    return `Failed to parse document: ${error.message}`;
  }
}

module.exports = { parseLocalDocument };
