import { timingSafeEqual } from "node:crypto";

const subtle = globalThis.crypto.subtle as SubtleCrypto & {
  timingSafeEqual?: (a: BufferSource, b: BufferSource) => boolean;
};

if (typeof subtle.timingSafeEqual !== "function") {
  Object.defineProperty(subtle, "timingSafeEqual", {
    configurable: true,
    value(a: BufferSource, b: BufferSource) {
      const left = Buffer.from(a as ArrayBuffer);
      const right = Buffer.from(b as ArrayBuffer);
      if (left.byteLength !== right.byteLength) return false;
      return timingSafeEqual(left, right);
    },
  });
}
