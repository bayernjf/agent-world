import jpeg from "jpeg-js";
import { PNG } from "pngjs";

/**
 * Image decoding/encoding for the `convert` node: pure-JS codecs only
 * (`pngjs` for PNG, `jpeg-js` for JPEG — no native dependencies). Format is
 * detected by magic bytes so mislabelled MIME types still decode correctly.
 */

export interface DecodedImage {
  width: number;
  height: number;
  /** RGBA raw pixels. */
  data: Buffer;
}

/** Decode a PNG or JPEG buffer into RGBA raw pixels. Throws on other formats. */
export function decodeImage(buf: Buffer): DecodedImage {
  const isPng = buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const isJpeg = buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (isPng) {
    const png = PNG.sync.read(buf);
    return { width: png.width, height: png.height, data: png.data };
  }
  if (isJpeg) {
    const img = jpeg.decode(buf, { useTArray: true });
    return { width: img.width, height: img.height, data: Buffer.from(img.data) };
  }
  throw new Error("不支持的图片格式（仅支持 PNG / JPEG 解码）");
}

/** Re-encode RGBA raw pixels as a JPEG buffer. `quality` is 1-100. */
export function encodeJpeg(img: DecodedImage, quality: number): Buffer {
  return Buffer.from(jpeg.encode({ width: img.width, height: img.height, data: img.data }, quality).data);
}

/** Re-encode RGBA raw pixels as a PNG buffer. */
export function encodePng(img: DecodedImage): Buffer {
  const png = new PNG({ width: img.width, height: img.height, colorType: 6 });
  png.data = img.data;
  return PNG.sync.write(png);
}
