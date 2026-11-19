import { describe, it, expect } from "@jest/globals";
import { crc32 } from "node:zlib";
import { detectPosterType, POSTER_MAX_BYTES, sanitizePoster } from "@ride/db/poster";

/**
 * Posters are public, and a phone photo's metadata can carry where it was taken.
 * These build small files by hand so the exact bytes under test are visible.
 */

function segment(marker: number, payload: Buffer): Buffer {
  const head = Buffer.from([0xff, marker, 0, 0]);
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
}

/** SOI, the given segments, a start of scan with some "image data", and EOI. */
function jpeg(...segments: Buffer[]): Buffer {
  const sos = segment(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0]));
  return Buffer.concat([Buffer.from([0xff, 0xd8]), ...segments, sos, Buffer.from("IMAGEDATA"), Buffer.from([0xff, 0xd9])]);
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}

function png(...chunks: Buffer[]): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", Buffer.alloc(13)),
    ...chunks,
    chunk("IDAT", Buffer.from("PIXELS")),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const jfif = segment(0xe0, Buffer.from("JFIF\0rest"));
const exifWithGps = segment(0xe1, Buffer.from("Exif\0\0GPSLatitude -26.2041 home of the owner"));
const xmp = segment(0xe1, Buffer.from("http://ns.adobe.com/xap/1.0/\0<x:creator>Jane Owner</x:creator>"));
const comment = segment(0xfe, Buffer.from("taken on Jane's phone"));
const quantTable = segment(0xdb, Buffer.alloc(65, 1));

describe("a JPEG poster", () => {
  it("loses its EXIF, XMP and comments and keeps its frame, tables and image data", () => {
    const result = sanitizePoster(jpeg(jfif, exifWithGps, xmp, comment, quantTable));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const text = result.bytes.toString("latin1");
    for (const leak of ["GPSLatitude", "-26.2041", "Jane Owner", "Jane's phone", "Exif"]) expect(text).not.toContain(leak);
    expect(text).toContain("JFIF");
    expect(text).toContain("IMAGEDATA");
    expect(result.bytes.subarray(-2)).toEqual(Buffer.from([0xff, 0xd9]));
    expect(result.removed).toEqual(["APP1", "APP1", "COM"]);
    expect(result.type).toBe("image/jpeg");
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is refused when a segment runs past the end of the file", () => {
    const broken = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x7f, 0xff]), Buffer.from("short")]);
    expect(sanitizePoster(broken)).toEqual({ ok: false, reason: expect.stringMatching(/damaged/) });
  });
});

describe("a PNG poster", () => {
  it("loses its text, EXIF and time chunks and keeps the image", () => {
    const result = sanitizePoster(
      png(
        chunk("tEXt", Buffer.from("Author\0Jane Owner")),
        chunk("eXIf", Buffer.from("GPS -26.2041")),
        chunk("tIME", Buffer.alloc(7)),
        chunk("pHYs", Buffer.alloc(9))
      )
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const text = result.bytes.toString("latin1");
    for (const leak of ["Jane Owner", "-26.2041", "tEXt", "eXIf", "tIME"]) expect(text).not.toContain(leak);
    expect(text).toContain("PIXELS");
    expect(text).toContain("pHYs");
    expect(result.removed).toEqual(["tEXt", "eXIf", "tIME"]);
  });

  it("is refused without its end chunk, or with an unknown critical chunk", () => {
    const noEnd = png().subarray(0, -12);
    expect(sanitizePoster(noEnd).ok).toBe(false);
    expect(sanitizePoster(png(chunk("ABCD", Buffer.alloc(1)))).ok).toBe(false);
  });
});

describe("any other file", () => {
  it("is refused by its content, whatever it claims to be", () => {
    expect(detectPosterType(Buffer.from("<svg onload=alert(1)>"))).toBeNull();
    expect(detectPosterType(Buffer.from("GIF89a"))).toBeNull();
    expect(sanitizePoster(Buffer.from("%PDF-1.7")).ok).toBe(false);
    expect(sanitizePoster(Buffer.alloc(0))).toEqual({ ok: false, reason: "The poster file is empty" });
  });

  it("is refused above 2 MB", () => {
    const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(POSTER_MAX_BYTES)]);
    expect(sanitizePoster(big)).toEqual({ ok: false, reason: "The poster must be 2 MB or smaller" });
  });
});
