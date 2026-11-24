import { invoke } from '@tauri-apps/api/core';
import type { CatSkinConfig } from './catSkins';

export function bindSkinImport(): () => void {
  const input = document.getElementById('cat-skin-file') as HTMLInputElement;
  const result = document.getElementById('cat-skin-result') as HTMLElement;
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      if (file.size > 1024 * 1024) throw new Error('皮肤文件不能超过 1 MB。');
      const cat = await invoke<CatSkinConfig>('import_cat_skin', { json: await file.text() });
      result.textContent = '已导入 ' + cat.name;
    } catch (error) {
      result.textContent = error instanceof Error ? error.message : String(error);
    }
    result.hidden = false;
  });
  return () => input.click();
}
