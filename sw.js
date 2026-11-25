/* 歌词卡片 · service worker（经典脚本，不是模块）
 *
 * 发布新版本时：把下面两个缓存名里的版本号一起加一（见 README），
 * 同时改 src/config.js 里的 APP_VERSION。
 *
 * 策略：
 *  - 页面（导航请求）：网络优先，断网或太慢时用缓存里的 index.html
 *  - 同源静态文件：先给缓存，同时后台更新（stale-while-revalidate）
 *  - 跨域字体样式表和字体文件：缓存优先，放在单独的字体缓存里
 *  - 在 localhost 上改成网络优先，方便开发时看到最新的文件
 */
'use strict';

const CACHE = 'lyric-card-v5';
const FONT_CACHE = 'lyric-card-fonts-v5';
const KEEP = [CACHE, FONT_CACHE];

// 相对 sw.js 所在目录，页面放在任何子路径都成立
const INDEX = 'index.html';
const PRECACHE = [
  INDEX,
  'styles/app.css',
  'src/app.js',
  'src/config.js',
  'src/storage.js',
  'src/color.js',
  'src/lyrics.js',
  'src/text.js',
  'src/render/common.js',
  'src/render/templates.js',
  'src/render/index.js',
  'vendor/qrcode.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'icons/icon.svg',
];

// 已知的字体站点。其他站点（镜像、自建）靠请求类型识别：
// 这个应用里唯一的跨域资源就是字体样式表和字体文件。
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'fonts.loli.net', 'gstatic.loli.net'];

const DEV = ['localhost', '127.0.0.1', '[::1]'].includes(self.location.hostname);
const NAVIGATE_TIMEOUT = 4500;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const requests = PRECACHE.map((url) => new Request(url, { cache: 'reload' }));
    if (DEV) {
      // 开发时文件可能还没写完，缺几个不影响安装
      await Promise.allSettled(requests.map((r) => cache.add(r)));
    } else {
      // 线上要么全部缓存成功，要么这次安装作废、继续用旧版本
      await cache.addAll(requests);
    }
    // 根目录（./）有的服务器没配默认首页，单独试，失败也没关系
    try { await cache.add(new Request('./', { cache: 'reload' })); } catch (err) { /* 忽略 */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith('lyric-card') && !KEEP.includes(key))
        .map((key) => caches.delete(key)),
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return;

  const url = new URL(req.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  if (url.origin !== self.location.origin) {
    if (isFontRequest(req, url)) event.respondWith(cacheFirst(req, FONT_CACHE));
    return;
  }

  if (req.mode === 'navigate') {
    event.respondWith(navigate(event, req, url));
    return;
  }
  event.respondWith(DEV ? networkFirst(req) : staleWhileRevalidate(event, req));
});

function isFontRequest(req, url) {
  return FONT_HOSTS.includes(url.hostname) || req.destination === 'font' || req.destination === 'style';
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && (res.ok || res.type === 'opaque')) {
    cache.put(req, res.clone()).catch(() => {});
  }
  return res;
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' });
    if (res.ok && res.type === 'basic') cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch (err) {
    const hit = await cache.match(req);
    if (hit) return hit;
    throw err;
  }
}

async function staleWhileRevalidate(event, req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  const refresh = fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' })
    .then((res) => {
      if (res.ok && res.type === 'basic') cache.put(req, res.clone()).catch(() => {});
      return res;
    })
    .catch(() => null);
  if (hit) {
    event.waitUntil(refresh);
    return hit;
  }
  return (await refresh) || Response.error();
}

async function navigate(event, req, url) {
  const cache = await caches.open(CACHE);
  const network = fetch(req);
  network.catch(() => {}); // 超时后改用缓存时，别让它变成未处理的拒绝
  const timer = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NAVIGATE_TIMEOUT));
  try {
    const res = await Promise.race([network, timer]);
    if (res.status >= 500) {
      const hit = await cache.match(INDEX);
      if (hit) return hit;
    }
    if (res.ok && res.type === 'basic' && isAppRoot(url)) {
      event.waitUntil(cache.put(INDEX, res.clone()).catch(() => {}));
    }
    return res;
  } catch (err) {
    const hit = await cache.match(INDEX);
    if (hit) return hit;
    return network; // 没有缓存可用：等网络本身的结果（失败就是浏览器的离线页）
  }
}

// 页面地址是 sw.js 所在目录，或其中的 index.html（带不带查询串都算）
function isAppRoot(url) {
  const dir = new URL('./', self.location.href).pathname;
  return url.pathname === dir || url.pathname === dir + INDEX;
}
