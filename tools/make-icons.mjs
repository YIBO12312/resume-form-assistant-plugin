/**
 * 生成扩展图标（纯形状绘制，不依赖字体，避免缺字）。
 * 运行： node tools/make-icons.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'assets', 'icons');
mkdirSync(OUT, { recursive: true });

// 用 SVG 画，再交给 sharp？没有 sharp。改用 SVG → 直接写成 .svg 不行（manifest 需要 png）。
// 因此这里用最小的 PNG 编码器手写像素。
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function png(size, pixels) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = pixels[i];
      raw[o + 1] = pixels[i + 1];
      raw[o + 2] = pixels[i + 2];
      raw[o + 3] = pixels[i + 3];
    }
  }
  const zlib2 = zlib;
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib2.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/** 用 4x 超采样画图标：圆角方块 + 白色文档 + 绿色对勾 */
function render(S) {
  const SS = 4;
  const N = S * SS;
  const px = new Uint8ClampedArray(N * N * 4);

  const radius = N * 0.24;
  const put = (x, y, r, g, b, a) => {
    const i = (y * N + x) * 4;
    const sa = a / 255;
    px[i] = px[i] * (1 - sa) + r * sa;
    px[i + 1] = px[i + 1] * (1 - sa) + g * sa;
    px[i + 2] = px[i + 2] * (1 - sa) + b * sa;
    px[i + 3] = Math.max(px[i + 3], a);
  };

  // 圆角矩形填充（蓝紫渐变）
  const inRoundRect = (x, y, x0, y0, x1, y1, rad) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    const cx = Math.min(Math.max(x, x0 + rad), x1 - rad);
    const cy = Math.min(Math.max(y, y0 + rad), y1 - rad);
    const dx = x - cx, dy = y - cy;
    return dx * dx + dy * dy <= rad * rad;
  };

  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (inRoundRect(x, y, 0, 0, N - 1, N - 1, radius)) {
        const t = (x / N) * 0.5 + (y / N) * 0.5;
        const r = Math.round(37 + (29 - 37) * t);
        const g = Math.round(99 + (78 - 99) * t);
        const b = Math.round(235 + (216 - 235) * t);
        put(x, y, r, g, b, 255);
      }
    }
  }

  // 白色文档
  const dx0 = N * 0.26, dx1 = N * 0.74;
  const dy0 = N * 0.20, dy1 = N * 0.80;
  const drad = N * 0.06;
  for (let y = Math.floor(dy0); y <= dy1; y++) {
    for (let x = Math.floor(dx0); x <= dx1; x++) {
      if (inRoundRect(x, y, dx0, dy0, dx1, dy1, drad)) put(x, y, 255, 255, 255, 255);
    }
  }

  // 文档里的三条灰线
  for (let k = 0; k < 3; k++) {
    const ly = Math.round(dy0 + (dy1 - dy0) * (0.22 + k * 0.18));
    const lx0 = Math.round(dx0 + (dx1 - dx0) * 0.16);
    const lx1 = Math.round(dx1 - (dx1 - dx0) * (k === 2 ? 0.42 : 0.16));
    const th = Math.max(1, Math.round(N * 0.035));
    for (let y = ly; y < ly + th; y++) {
      for (let x = lx0; x <= lx1; x++) put(x, y, 148, 163, 184, 255);
    }
  }

  // 绿色对勾（右下角）
  const cx = N * 0.70, cy = N * 0.74;
  const R = N * 0.22;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d <= R) put(x, y, 22, 163, 74, 255);
    }
  }
  const tick = (x, y) => {
    // 两段折线
    const p1 = [cx - R * 0.46, cy + R * 0.02];
    const p2 = [cx - R * 0.12, cy + R * 0.36];
    const p3 = [cx + R * 0.5, cy - R * 0.38];
    const seg = (a, b) => {
      const vx = b[0] - a[0], vy = b[1] - a[1];
      const wx = x - a[0], wy = y - a[1];
      const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / (vx * vx + vy * vy)));
      return Math.hypot(wx - vx * t, wy - vy * t);
    };
    return Math.min(seg(p1, p2), seg(p2, p3)) <= N * 0.045;
  };
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (Math.hypot(x - cx, y - cy) <= R && tick(x, y)) put(x, y, 255, 255, 255, 255);
    }
  }

  // 超采样降采样
  const out = new Uint8ClampedArray(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const i = ((y * SS + sy) * N + (x * SS + sx)) * 4;
          r += px[i]; g += px[i + 1]; b += px[i + 2]; a += px[i + 3];
        }
      }
      const n = SS * SS;
      const o = (y * S + x) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = Math.round(a / n);
    }
  }
  return out;
}

// 超采样降采样后写出
for (const size of [16, 32, 48, 128]) {
  const pixels = render(size);
  const buf = png(size, pixels);
  const file = join(OUT, `icon${size}.png`);
  writeFileSync(file, buf);
  console.log(`写入 ${file}（${buf.length} 字节）`);
}
