import { readFile, writeFile } from 'node:fs/promises';

const [metaPath, atlasPath, outputPath] = process.argv.slice(2);
if (!outputPath) throw new Error('用法：node pack.mjs skin-meta.json atlas.png custom-cat.json');
const skin = JSON.parse(await readFile(metaPath, 'utf8'));
const png = await readFile(atlasPath);
if (!png.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) || png.length < 33) {
  throw new Error('贴图必须是 PNG');
}
const width = png.readUInt32BE(16);
const height = png.readUInt32BE(20);
if (png.length > 512 * 1024 || width > 768 || height > 768) throw new Error('贴图超过导入尺寸或大小限制');
const parts = ['head', 'body', 'tail', 'upperLeg', 'foreleg'];
if (skin.photo?.rig?.collar != null) parts.push('collar');
for (const part of parts) {
  const rect = skin.photo?.rig?.[part];
  if (!Array.isArray(rect) || rect.length !== 4 || !rect.every(Number.isInteger)) {
    throw new Error('需要整数像素矩形：' + part);
  }
  const [x, y, w, h] = rect;
  if (x < 0 || y < 0 || w < 8 || h < 8 || x + w > width || y + h > height) {
    throw new Error('矩形太小或超出贴图：' + part);
  }
}
skin.photo.png = png.toString('base64');
const json = JSON.stringify(skin);
if (Buffer.byteLength(json) > 1024 * 1024) throw new Error('皮肤 JSON 超过 1 MB');
await writeFile(outputPath, json, { flag: 'wx' });
