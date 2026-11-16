import { copyFileSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const MAX_SIZE = 1024 * 1024;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

const MAX_DIMENSION = 1024;

function pngDimensions(buf: Buffer): { width: number; height: number } {
  // IHDR: 8-byte signature, 4-byte length, 4-byte "IHDR", then width/height (BE uint32).
  if (buf.length < 33 || buf.toString("ascii", 12, 16) !== "IHDR") {
    fail("malformed PNG: missing IHDR chunk");
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function jpegDimensions(buf: Buffer): { width: number; height: number } {
  // Walk JPEG markers until a Start-of-Frame segment (0xC0-0xCF except
  // 0xC4 DHT, 0xC8 JPG, 0xCC DAC); it holds height then width (BE uint16).
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) fail("malformed JPEG: expected marker");
    const marker = buf[i + 1];
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const length = buf.readUInt16BE(i + 2);
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + length;
  }
  fail("malformed JPEG: no Start-of-Frame segment found");
}

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

const outDir = process.env.MAKEFUN_OUTPUT_DIR;
if (!outDir) fail("MAKEFUN_OUTPUT_DIR is not set");

const src = join(import.meta.dirname, "entry.png");
let data: Buffer;
try {
  data = readFileSync(src);
} catch {
  fail(`cannot read ${src}`);
}

const isPng = data.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC);
const isJpeg = data.subarray(0, JPEG_MAGIC.length).equals(JPEG_MAGIC);
if (!isPng && !isJpeg) {
  fail("entry.png is neither PNG nor JPEG (bad magic bytes)");
}

if (statSync(src).size > MAX_SIZE) {
  fail(`entry.png exceeds 1 MiB (${statSync(src).size} bytes)`);
}

const { width, height } = isPng ? pngDimensions(data) : jpegDimensions(data);
if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
  fail(`entry.png is ${width}x${height}, exceeding the ${MAX_DIMENSION}x${MAX_DIMENSION} cap`);
}

copyFileSync(src, join(outDir, "entry.png"));
console.log(`copied entry.png (${data.length} bytes) to ${outDir}`);
