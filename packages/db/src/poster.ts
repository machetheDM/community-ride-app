import { createHash } from "node:crypto";

/**
 * Cleans an event poster before it is stored and shown to the public (docs/PLAN.md
 * Phase 3.2; threat model PL-8).
 *
 * A phone photo of a poster carries the phone's EXIF: often the GPS position it
 * was taken at, which for a venue owner may be their home, plus the device and
 * sometimes the author's name. A public page must not hand that out.
 *
 * This removes the metadata segments and copies the image data byte for byte, in
 * plain TypeScript, so no image library is added for it. It does not decode or
 * re-encode: a file whose structure does not parse is refused rather than passed
 * through, so a malformed or disguised file never reaches the page.
 */

export const POSTER_MAX_BYTES = 2 * 1024 * 1024;

export type PosterType = "image/jpeg" | "image/png";

export type PosterResult =
  | { ok: true; bytes: Buffer; type: PosterType; sha256: string; removed: string[] }
  | { ok: false; reason: string };

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** The type from the file's own first bytes; the name and the browser's claim are never trusted. */
export function detectPosterType(bytes: Buffer): PosterType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return "image/png";
  return null;
}

/**
 * JPEG: keeps the frame, the tables, APP0 (JFIF) and APP14 (Adobe, which some
 * CMYK files need to show the right colours); drops APP1 to APP13 and APP15 (EXIF,
 * XMP, IPTC, maker notes) and comments. Everything from the start of scan on is
 * the compressed image and is copied as it is.
 */
function stripJpeg(bytes: Buffer): { bytes: Buffer; removed: string[] } | null {
  const out: Buffer[] = [bytes.subarray(0, 2)];
  const removed: string[] = [];
  let i = 2;
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    // Fill bytes between segments are allowed.
    while (i < bytes.length && bytes[i] === 0xff && bytes[i + 1] === 0xff) i++;
    const marker = bytes[i + 1];
    if (marker === undefined) return null;
    if (marker === 0xd9) {
      out.push(bytes.subarray(i, i + 2));
      return { bytes: Buffer.concat(out), removed };
    }
    if (i + 4 > bytes.length) return null;
    const length = bytes.readUInt16BE(i + 2);
    if (length < 2 || i + 2 + length > bytes.length) return null;
    const segment = bytes.subarray(i, i + 2 + length);

    if (marker === 0xda) {
      // Start of scan: the rest of the file is image data and the end marker.
      out.push(bytes.subarray(i));
      return { bytes: Buffer.concat(out), removed };
    }
    const isApp = marker >= 0xe0 && marker <= 0xef;
    const keepApp = marker === 0xe0 || marker === 0xee;
    if ((isApp && !keepApp) || marker === 0xfe) {
      removed.push(marker === 0xfe ? "COM" : `APP${marker - 0xe0}`);
    } else {
      out.push(segment);
    }
    i += 2 + length;
  }
  return null;
}

/** PNG chunks that carry no metadata and are kept; anything else ancillary is dropped. */
const PNG_KEEP = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "gAMA", "cHRM", "sRGB", "iCCP", "sBIT", "pHYs", "bKGD"]);

/** PNG: drops text, EXIF and time chunks (tEXt, zTXt, iTXt, eXIf, tIME and any unknown ancillary chunk). */
function stripPng(bytes: Buffer): { bytes: Buffer; removed: string[] } | null {
  const out: Buffer[] = [PNG_SIGNATURE];
  const removed: string[] = [];
  let i = 8;
  let sawEnd = false;
  while (i < bytes.length) {
    if (i + 12 > bytes.length) return null;
    const length = bytes.readUInt32BE(i);
    const type = bytes.subarray(i + 4, i + 8).toString("latin1");
    if (!/^[A-Za-z]{4}$/.test(type)) return null;
    const end = i + 12 + length;
    if (end > bytes.length) return null;
    const critical = type.charCodeAt(0) < 0x61; // upper-case first letter
    if (critical || PNG_KEEP.has(type)) {
      if (critical && !PNG_KEEP.has(type)) return null; // an unknown critical chunk: not a PNG we can vouch for
      out.push(bytes.subarray(i, end));
    } else {
      removed.push(type);
    }
    i = end;
    if (type === "IEND") {
      sawEnd = true;
      break;
    }
  }
  return sawEnd ? { bytes: Buffer.concat(out), removed } : null;
}

export function sanitizePoster(input: Buffer): PosterResult {
  if (input.length === 0) return { ok: false, reason: "The poster file is empty" };
  if (input.length > POSTER_MAX_BYTES) return { ok: false, reason: "The poster must be 2 MB or smaller" };
  const type = detectPosterType(input);
  if (!type) return { ok: false, reason: "The poster must be a JPEG or PNG image" };

  const stripped = type === "image/jpeg" ? stripJpeg(input) : stripPng(input);
  if (!stripped) return { ok: false, reason: "The poster file is damaged or not a real image" };

  return {
    ok: true,
    bytes: stripped.bytes,
    type,
    sha256: createHash("sha256").update(stripped.bytes).digest("hex"),
    removed: stripped.removed,
  };
}
