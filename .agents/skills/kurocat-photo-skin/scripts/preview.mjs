import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createServer, normalizePath } from 'vite';

const [skinPath, port = '5179'] = process.argv.slice(2);
if (!skinPath) throw new Error('用法：node preview.mjs custom-cat.json [端口]');
const skin = JSON.parse(await readFile(skinPath, 'utf8'));
if (!skin.id || !skin.name) throw new Error('皮肤缺少 id 或 name');

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const server = await createServer({
  configFile: resolve(root, 'vite.web.config.ts'),
  server: { host: '127.0.0.1', port: Number(port) },
  plugins: [{
    name: 'kurocat-local-skin',
    enforce: 'pre',
    transform(source, id) {
      const file = id.split('?')[0];
      if (file === normalizePath(resolve(root, 'website/src/builtinCats.ts'))) {
        return 'export const BUILTIN_WEB_CATS = [' + JSON.stringify(skin) + '];';
      }
      if (file === normalizePath(resolve(root, 'website/src/main.ts'))) {
        return source + '\nArray.from(document.querySelectorAll("[data-skin-id]")).find(button => button.dataset.skinId === ' +
          JSON.stringify(skin.id) + ')?.click();';
      }
    },
  }],
});
await server.listen();
console.log(new URL('#playground', server.resolvedUrls.local[0]).href);
