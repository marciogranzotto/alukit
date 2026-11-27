import { inflateSync } from "node:zlib";

/**
 * A PNG decoder for the snapshot tests: 8-bit RGB or RGBA, not interlaced, which is what
 * Chromium writes ([PNG §11.2.2, §9](https://www.w3.org/TR/png-3/)). Returns RGBA pixels.
 */

export interface Image {
  width: number;
  height: number;
  /** RGBA, row by row. */
  data: Uint8Array;
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function decodePng(buf: Uint8Array): Image {
  if (!SIGNATURE.every((b, i) => buf[i] === b)) throw new Error("not a PNG");
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let at = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat: Uint8Array[] = [];
  while (at < buf.length) {
    const len = view.getUint32(at);
    const type = String.fromCharCode(...buf.subarray(at + 4, at + 8));
    const body = buf.subarray(at + 8, at + 8 + len);
    if (type === "IHDR") {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      const depth = body[8];
      const colour = body[9];
      const interlace = body[12];
      if (depth !== 8 || (colour !== 2 && colour !== 6) || interlace !== 0) {
        throw new Error(
          `unsupported PNG: depth ${depth}, colour type ${colour}, interlace ${interlace}`,
        );
      }
      channels = colour === 6 ? 4 : 3;
    } else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
    at += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const rows = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] as number;
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = rows.subarray(y * stride, (y + 1) * stride);
    const up = y > 0 ? rows.subarray((y - 1) * stride, y * stride) : undefined;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? (out[i - channels] as number) : 0;
      const b = up ? (up[i] as number) : 0;
      const c = up && i >= channels ? (up[i - channels] as number) : 0;
      const x = src[i] as number;
      const v =
        filter === 0
          ? x
          : filter === 1
            ? x + a
            : filter === 2
              ? x + b
              : filter === 3
                ? x + ((a + b) >> 1)
                : x + paeth(a, b, c);
      out[i] = v & 0xff;
    }
  }
  const data = new Uint8Array(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    data[p * 4] = rows[p * channels] as number;
    data[p * 4 + 1] = rows[p * channels + 1] as number;
    data[p * 4 + 2] = rows[p * channels + 2] as number;
    data[p * 4 + 3] = channels === 4 ? (rows[p * channels + 3] as number) : 255;
  }
  return { width, height, data };
}

/** The share of pixels whose colour differs by more than `tol` in any channel. */
export function differing(a: Image, b: Image, tol = 8): number {
  if (a.width !== b.width || a.height !== b.height) return 1;
  let n = 0;
  for (let p = 0; p < a.width * a.height; p++) {
    for (let k = 0; k < 3; k++) {
      if (Math.abs((a.data[p * 4 + k] as number) - (b.data[p * 4 + k] as number)) > tol) {
        n++;
        break;
      }
    }
  }
  return n / (a.width * a.height);
}

/**
 * The share of pixels that are not their row's most common colour: zero for a blank image. By
 * row, because the 3D view's background is a vertical gradient (docs/ux/visual-design.md §5.1):
 * each row of it is one colour, and only what is drawn over it counts.
 */
export function coverage(img: Image): number {
  let covered = 0;
  for (let y = 0; y < img.height; y++) {
    const counts = new Map<number, number>();
    for (let x = 0; x < img.width; x++) {
      const p = y * img.width + x;
      const key =
        ((img.data[p * 4] as number) << 16) |
        ((img.data[p * 4 + 1] as number) << 8) |
        (img.data[p * 4 + 2] as number);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    covered += img.width - Math.max(...counts.values());
  }
  return covered / (img.width * img.height);
}
