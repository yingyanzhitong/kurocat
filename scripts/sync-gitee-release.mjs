import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

const giteeRepo = 'masongzhi1/kurocat';
const giteeApi = `https://gitee.com/api/v5/repos/${giteeRepo}`;
const tag = process.env.RELEASE_TAG;
const token = process.env.GITEE_TOKEN;
const isPortable = ({ name }) => name.endsWith('.AppImage');

async function gitee(path, { method = 'GET', body, anonymous = false, allowMissing = false } = {}) {
  const headers = { Accept: 'application/json' };
  if (!anonymous) headers.Authorization = `Bearer ${token}`;
  if (body) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }
  const response = await fetch(giteeApi + path, {
    method, headers, body, signal: AbortSignal.timeout(240_000),
  });
  if (allowMissing && response.status === 404) return null;
  if (!response.ok) throw new Error(`Gitee ${method} ${path}: HTTP ${response.status}`);
  return response.status === 204 ? null : response.json();
}

function uploadInstaller(path, file, maxTime) {
  const response = execFileSync('curl', [
    '--http1.1', '--header', 'Expect:', '--silent', '--show-error',
    '--connect-timeout', '15', '--max-time', maxTime,
    '--speed-limit', '10240', '--speed-time', '20',
    '--config', '-', '--form', `file=@${file}`, '--write-out', '\n%{http_code}',
    giteeApi + path,
  ], {
    encoding: 'utf8',
    input: `header = ${JSON.stringify(`Authorization: Bearer ${token}`)}\n`,
  });
  const split = response.lastIndexOf('\n');
  const status = Number(response.slice(split + 1));
  if (status < 200 || status >= 300) {
    throw Object.assign(new Error(`Gitee POST ${path}: HTTP ${status}`), { httpStatus: status });
  }
  return JSON.parse(response.slice(0, split));
}

async function syncInstaller(directory, attachmentsPath, asset) {
  const { name, size } = asset;
  const upload = () => uploadInstaller(attachmentsPath, join(directory, name), isPortable(asset) ? '120' : '240');
  console.log(`正在同步 ${name}`);
  let uploaded;
  try {
    uploaded = upload();
  } catch (error) {
    if (isPortable(asset) || (error.httpStatus && error.httpStatus < 500 && ![408, 429].includes(error.httpStatus))) {
      throw error;
    }
    const files = await gitee(`${attachmentsPath}?per_page=100`);
    uploaded = files.find(file => file.name === name && file.size === size) ?? upload();
  }
  if (uploaded.name !== name || uploaded.size !== size) throw new Error(`Gitee 附件校验失败：${name}`);
  console.log(`已同步 ${name}`);
}

function syncTag() {
  const ref = `refs/tags/${tag}`;
  const commit = execFileSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], { encoding: 'utf8' }).trim();
  console.log(`正在向 Gitee 推送标签 ${tag}`);
  execFileSync('git', [
    '-c', 'credential.helper=',
    '-c', 'credential.helper=!f() { if [ "$1" = get ]; then printf "username=%s\\npassword=%s\\n" "${GITEE_REPO_OWNER}" "${GITEE_TOKEN}"; fi; }; f',
    // Buffer the initial source push so Gitee receives it with a fixed Content-Length.
    '-c', 'http.version=HTTP/1.1',
    '-c', 'http.postBuffer=33554432',
    '-c', 'http.lowSpeedLimit=1024',
    '-c', 'http.lowSpeedTime=45',
    'push', `https://gitee.com/${giteeRepo}.git`, `${ref}:${ref}`,
  ], {
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GITEE_REPO_OWNER: giteeRepo.split('/')[0] },
    stdio: 'inherit',
    timeout: 180_000,
  });
  return commit;
}

async function syncRelease(directory) {
  const repository = await gitee('', { anonymous: true, allowMissing: true });
  if (!repository || repository.private) {
    throw new Error(`Gitee 仓库 ${giteeRepo} 必须公开，桌面客户端才能匿名检查更新`);
  }

  const source = JSON.parse(execFileSync('gh', [
    'release', 'view', tag, '--repo', process.env.GITHUB_REPOSITORY,
    '--json', 'tagName,isDraft,isPrerelease,name,body,assets',
  ], { encoding: 'utf8' }));
  if (source.tagName !== tag || source.isDraft || source.isPrerelease) {
    throw new Error(`GitHub ${tag} 必须是已发布的正式版本`);
  }
  const installers = source.assets.filter(({ name }) =>
    /^KuroCat-[\w.-]+\.(?:exe|dmg|deb|AppImage|app\.tar\.gz|zip)$/.test(name));
  const required = [
    `KuroCat-${tag.slice(1)}-x64-setup.exe`,
    `KuroCat-${tag}-macos-universal.dmg`,
    `KuroCat-${tag}-macos-universal.app.tar.gz`,
    `KuroCat-${tag}-linux-amd64.deb`,
    `KuroCat-${tag}-linux-arm64.deb`,
  ];
  const missing = required.filter(name => !installers.some(asset => asset.name === name));
  if (missing.length) throw new Error(`GitHub Release 缺少安装包：${missing.join(', ')}`);
  console.log(`正在下载并校验 GitHub ${tag} 的 ${installers.length} 个安装包`);
  const downloadPrefix = `https://github.com/${process.env.GITHUB_REPOSITORY}/releases/download/${tag}/`;
  const downloads = await Promise.allSettled(installers.map(async ({ name, url, size, digest }) => {
    if (size <= 0 || size > 100 * 1024 * 1024) throw new Error(`${name} 超出 Gitee 附件大小限制`);
    if (url !== downloadPrefix + name) throw new Error(`GitHub 下载地址不匹配：${name}`);
    const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
    if (!response.ok) throw new Error(`GitHub 下载失败：${name}（HTTP ${response.status}）`);
    const file = join(directory, name);
    await pipeline(response.body, createWriteStream(file));
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    const sha256 = hash.digest('hex');
    if ((await stat(file)).size !== size || (digest && digest !== `sha256:${sha256}`)) {
      throw new Error(`GitHub 附件校验失败：${name}`);
    }
    return { sha256, size };
  }));
  const metadata = {};
  const available = [];
  for (const [index, asset] of installers.entries()) {
    const result = downloads[index];
    if (result.status === 'fulfilled') {
      metadata[asset.name] = result.value;
      available.push(asset);
    } else if (isPortable(asset)) {
      console.warn(`::warning::${asset.name} 下载或校验失败，仍可从 GitHub 下载`);
      if (/^sha256:[0-9a-f]{64}$/.test(asset.digest ?? '')) {
        metadata[asset.name] = { sha256: asset.digest.slice(7), size: asset.size };
      }
    } else {
      throw result.reason;
    }
  }

  const requiredInstallers = available.filter(asset => !isPortable(asset));
  const name = source.name || `KuroCat ${tag}`;
  let notes = source.body?.trim() || name;
  if (installers.some(isPortable)) {
    notes += `\n\nLinux AppImage 可从 [GitHub Release](https://github.com/${process.env.GITHUB_REPOSITORY}/releases/tag/${tag}) 下载。`;
  }
  const body = `${notes}\n\n<!-- KuroCat update assets\n${JSON.stringify(metadata)}\n-->`;
  const final = { tag_name: tag, name, body, prerelease: false };
  const target_commitish = syncTag();
  const existing = await gitee(`/releases/tags/${tag}`, { allowMissing: true });
  const release = existing ?? await gitee('/releases', {
    method: 'POST', body: { ...final, prerelease: true, target_commitish },
  });
  const releasePath = `/releases/${release.id}`;
  const attachmentsPath = `${releasePath}/attach_files`;
  const attachments = await gitee(`${attachmentsPath}?per_page=100`);
  const hasAllDownloads = (release, packages) => packages.every(asset => release.assets.some(file =>
    file.name === asset.name &&
    file.browser_download_url === `https://gitee.com/${giteeRepo}/releases/download/${tag}/${asset.name}`));
  const hasAttachments = packages => packages.every(asset =>
    attachments.some(file => file.name === asset.name && file.size === asset.size));
  const alreadyPublished = !release.prerelease && release.name === name && release.body === body &&
    hasAllDownloads(release, requiredInstallers) && hasAttachments(requiredInstallers);
  if (alreadyPublished && hasAllDownloads(release, available) && hasAttachments(available)) {
    console.log(`Gitee ${tag} 已同步`);
    return;
  }

  if (!alreadyPublished && !release.prerelease) {
    await gitee(releasePath, { method: 'PATCH', body: { ...final, body: release.body, prerelease: true } });
  }
  const retained = new Set();
  for (const attachment of attachments) {
    if (!Object.hasOwn(metadata, attachment.name)) continue;
    if (release.body === body && attachment.size === metadata[attachment.name].size && !retained.has(attachment.name)) {
      retained.add(attachment.name);
    } else {
      await gitee(`${attachmentsPath}/${attachment.id}`, { method: 'DELETE' });
    }
  }
  if (release.body !== body) {
    await gitee(releasePath, { method: 'PATCH', body: { ...final, prerelease: true } });
  }
  for (const asset of requiredInstallers) {
    if (!retained.has(asset.name)) await syncInstaller(directory, attachmentsPath, asset);
  }
  if (!alreadyPublished) {
    await gitee(releasePath, { method: 'PATCH', body: final });
  }
  const published = await gitee(`/releases/tags/${tag}`, { anonymous: true });
  if (published.prerelease || published.body !== body || !hasAllDownloads(published, requiredInstallers)) {
    throw new Error(`Gitee ${tag} 未完整公开安装包`);
  }
  console.log(`https://gitee.com/${giteeRepo}/releases/tag/${tag}`);
  for (const asset of available.filter(isPortable)) {
    if (retained.has(asset.name)) continue;
    try {
      await syncInstaller(directory, attachmentsPath, asset);
    } catch {
      console.warn(`::warning::${asset.name} 上传 Gitee 失败，仍可从 GitHub 下载`);
    }
  }
}

if (!/^v\d+\.\d+\.\d+$/.test(tag ?? '')) {
  throw new Error('RELEASE_TAG 必须是 vX.Y.Z 格式的正式版本标签');
}
if (!token) throw new Error('GitHub Actions 缺少 GITEE_TOKEN');
const directory = await mkdtemp(join(tmpdir(), 'kurocat-release-'));
try {
  await syncRelease(directory);
} finally {
  await rm(directory, { force: true, recursive: true });
}
