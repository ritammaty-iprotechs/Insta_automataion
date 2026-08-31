/**
 * Draws the day's real fact directly onto the AI-generated background
 * image as a clean, attractive quote-card style overlay.
 *
 * Why this exists: AI image models (including free ones like Flux)
 * are unreliable at rendering legible text - letters come out warped
 * or misspelled. Instead, we generate a plain background photo with
 * AI, then draw the text ourselves in code with `sharp`. This gives
 * perfect, crisp, correctly-spelled text every single day.
 *
 * Requires the `sharp` package:
 *   npm install sharp
 */

const sharp = require("sharp");

function escapeXml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Simple greedy word-wrap by character count per line.
 */
function wrapText(text, maxCharsPerLine) {
  const words = text.split(/\s+/);
  const lines = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Overlays an attractive quote-card style banner containing the day's
 * fact text near the bottom of the image, over a smooth gradient scrim
 * so it always reads clearly regardless of the background photo.
 *
 * @param {Buffer} imageBuffer - raw background image bytes
 * @param {string} factText - the real fact to draw on the image
 * @param {string} [eyebrow] - small label above the fact, e.g. "DID YOU KNOW"
 * @param {string} [accentColor] - hex color for the accent line/eyebrow text
 * @param {number} width - target output width (default 1024)
 * @param {number} height - target output height (default 1024)
 * @returns {Promise<Buffer>} composited JPEG image buffer
 */
async function overlayFactOnImage({
  imageBuffer,
  factText,
  eyebrow = "DID YOU KNOW",
  accentColor = "#FFD166",
  width = 1024,
  height = 1024,
}) {
  const maxCharsPerLine = 32;
  const fontSize = 40;
  const lineHeight = 52;
  const marginSide = 64;

  const lines = wrapText(factText, maxCharsPerLine).slice(0, 6); // safety cap

  // Gradient scrim covers roughly the bottom 55% of the image so text
  // always has enough contrast, no matter what the background photo is.
  const scrimHeight = Math.round(height * 0.55);
  const scrimY = height - scrimHeight;

  // Stack from the bottom up: fact text lines, then a thin accent
  // line, then the eyebrow label above that.
  const textBlockHeight = lines.length * lineHeight;
  const accentLineY = height - 56 - textBlockHeight - 28;
  const eyebrowY = accentLineY - 22;
  const firstLineY = height - 56 - (lines.length - 1) * lineHeight;

  const factLinesSvg = lines
    .map((line, i) => {
      const y = firstLineY - (lines.length - 1 - i) * lineHeight;
      return `<text x="${width / 2}" y="${y}" font-family="Georgia, 'Times New Roman', serif" font-size="${fontSize}" font-weight="700" fill="#ffffff" text-anchor="middle" letter-spacing="0.3" filter="url(#textShadow)">${escapeXml(line)}</text>`;
    })
    .join("\n");

  const svgOverlay = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#000000" stop-opacity="0" />
          <stop offset="35%" stop-color="#000000" stop-opacity="0.35" />
          <stop offset="100%" stop-color="#000000" stop-opacity="0.82" />
        </linearGradient>
        <filter id="textShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000000" flood-opacity="0.55" />
        </filter>
      </defs>

      <rect x="0" y="${scrimY}" width="${width}" height="${scrimHeight}" fill="url(#scrim)" />

      <!-- accent line -->
      <rect x="${marginSide}" y="${accentLineY}" width="56" height="4" rx="2" fill="${accentColor}" />

      <!-- eyebrow label -->
      <text x="${marginSide}" y="${eyebrowY}" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="700" fill="${accentColor}" letter-spacing="3">${escapeXml(eyebrow.toUpperCase())}</text>

      <!-- fact text, centered -->
      ${factLinesSvg}
    </svg>
  `;

  const composedBuffer = await sharp(imageBuffer)
    .resize(width, height, { fit: "cover" })
    .composite([{ input: Buffer.from(svgOverlay), top: 0, left: 0 }])
    .jpeg({ quality: 92 })
    .toBuffer();

  return composedBuffer;
}

module.exports = { overlayFactOnImage };