import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');

// ============================================================
// 服装领域社媒雷达 - 数据源配置
// ============================================================

// YouTube 时尚行业频道（handle 或已确认的 channel_id）
const YOUTUBE_CHANNELS = [
  { handle: '@voguebusiness', id: null, label: 'Vogue Business' },   // 行业商业动态
  { handle: '@BusinessofFashion', id: 'UCe1qICvWRDbdH7-Fixvj7Bg', label: 'Business of Fashion' },
  { handle: '@wwd', id: null, label: 'WWD' },                        // Womens Wear Daily
  { handle: '@highsnobiety', id: 'UCNe161YMUykW264kFe5PWxA', label: 'Highsnobiety' },
];

// Google News 行业资讯搜索词（英文，来源覆盖 WWD/BoF/Reuters 等媒体）
const NEWS_QUERIES = [
  'fashion industry OR "fashion brand" OR apparel',
  '"fast fashion" OR SHEIN OR Zara OR "H&M" OR Uniqlo OR Temu',
  'fashion week OR luxury brand OR streetwear',
];

// 跨境男装品牌池（敦煌词库验证过的方向，社媒动向 → C级信号 → DH词库验证后升级）
const BRAND_POOL = [
  { label: 'Hellstar', query: 'Hellstar' },
  { label: 'BAPE', query: 'BAPE OR "A Bathing Ape" OR "Baby Milo"' },
  { label: 'Sp5der', query: 'Sp5der OR "Young Thug"' },
  { label: 'Chrome Hearts', query: '"Chrome Hearts"' },
  { label: 'Denim Tears', query: '"Denim Tears"' },
  { label: 'Amiri', query: '"Mike Amiri" OR "Amiri jeans" OR "Amiri shirt" OR "Amiri hoodie"' },
  { label: 'Nike Miler', query: '"Nike Miler"' },
];

// 服装领域关键词（用于过滤 X 热搜等泛数据源）
const FASHION_KEYWORDS = [
  'fashion', 'style', 'outfit', 'ootd', 'sneaker', 'streetwear', 'runway',
  'fashion week', 'met gala', 'vogue', 'wardrobe', 'closet', 'skims',
  'zara', 'shein', 'uniqlo', 'h&m', 'hm', 'nike', 'adidas', 'gucci',
  'prada', 'dior', 'louis vuitton', 'lv', 'chanel', 'balenciaga',
  'lululemon', 'puma', 'new balance', 'crocs', 'uggs', 'fast fashion',
  'apparel', 'clothing', 'garment', 'denim', 'dress', 'coat', 'shoes',
  'luxury', 'couture', 'dropshipping',
];

// TikTok 时尚媒体账号（尽力而为，走 RSSHub）
const TIKTOK_ACCOUNTS = ['voguebusiness', 'wwd', 'highsnobiety'];

const RSSHUB_INSTANCES = [
  'https://rsshub.app',
  'https://rsshub.pseudoyu.com',
  'https://rss.fatpandac.com'
];

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8'
};

async function fetchWithTimeout(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { headers: HEADERS, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

// 通用 RSS 解析（兼容 RSS <item> 和 Atom <entry> 两种格式）
async function fetchRSS(url, maxItems = 20) {
  try {
    const res = await fetchWithTimeout(url);
    const xml = await res.text();
    const $ = cheerio.load(xml, { xmlMode: true });
    const items = [];
    // RSS 2.0 格式
    $('item').slice(0, maxItems).each((i, el) => {
      items.push({
        title: $(el).find('title').text().trim(),
        link: $(el).find('link').text().trim(),
        pubDate: $(el).find('pubDate').text().trim()
      });
    });
    // Atom 格式（YouTube 等）
    if (items.length === 0) {
      $('entry').slice(0, maxItems).each((i, el) => {
        items.push({
          title: $(el).find('title').first().text().trim(),
          link: $(el).find('link').attr('href') || '',
          pubDate: ($(el).find('published').text() || $(el).find('updated').text()).trim()
        });
      });
    }
    return items;
  } catch (error) {
    console.error(`Failed to fetch ${url}:`, error.message);
    return [];
  }
}

// 解析 YouTube handle -> channel_id（运行时自动解析并缓存）
async function resolveChannelId(handle) {
  try {
    const res = await fetchWithTimeout(`https://www.youtube.com/${handle}`, 20000);
    const html = await res.text();
    const match = html.match(/"(UC[\w-]{22})"/);
    if (match) return match[1];
    const match2 = html.match(/channel\/(UC[\w-]{22})/);
    if (match2) return match2[1];
  } catch (e) {
    console.error(`Failed to resolve ${handle}:`, e.message);
  }
  return null;
}

// 1. 行业资讯（Google News，多查询合并去重）
async function fetchFashionNews() {
  const seen = new Set();
  const merged = [];
  const all = await Promise.all(NEWS_QUERIES.map(q =>
    fetchRSS(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`, 25)
  ));

  for (const items of all) {
    for (const item of items) {
      // Google News 标题带 " - 媒体名" 后缀，拆出标题和来源
      const idx = item.title.lastIndexOf(' - ');
      let title = item.title;
      let source = '';
      if (idx > 0) {
        source = item.title.slice(idx + 3);
        title = item.title.slice(0, idx);
      }
      const key = title.toLowerCase().slice(0, 60);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push({ title, source, url: item.link, pubDate: item.pubDate });
    }
  }
  return merged.slice(0, 30).map((item, index) => ({
    rank: index + 1,
    title: item.source ? `${item.title}` : item.title,
    url: item.url,
    hot: item.source,
    platform: 'news'
  }));
}

// 2. YouTube 时尚行业频道最新视频
async function fetchFashionYouTube() {
  // 补齐缺失的 channel_id
  const resolved = await Promise.all(YOUTUBE_CHANNELS.map(async ch => {
    if (ch.id) return ch;
    const id = await resolveChannelId(ch.handle);
    if (id) console.log(`Resolved ${ch.handle} -> ${id}`);
    return { ...ch, id };
  }));

  const all = await Promise.all(resolved.filter(ch => ch.id).map(async ch => {
    const items = await fetchRSS(`https://www.youtube.com/feeds/videos.xml?channel_id=${ch.id}`, 10);
    return items.map(item => ({ ...item, label: ch.label }));
  }));

  // 按发布时间排序（新的在前）
  const flat = all.flat().sort((a, b) =>
    new Date(b.pubDate || 0) - new Date(a.pubDate || 0)
  );

  const seen = new Set();
  const result = [];
  for (const item of flat) {
    const key = item.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      rank: result.length + 1,
      title: item.title,
      url: item.link,
      hot: item.label,
      platform: 'youtube'
    });
    if (result.length >= 25) break;
  }
  return result;
}

// 2.5 品牌池动态（每个品牌单独监控，标签标明品牌）
async function fetchBrandPool() {
  const all = await Promise.all(BRAND_POOL.map(async brand => {
    const items = await fetchRSS(
      `https://news.google.com/rss/search?q=${encodeURIComponent(brand.query)}&hl=en-US&gl=US&ceid=US:en`,
      6
    );
    return items.map(item => ({ ...item, brand: brand.label }));
  }));

  const flat = all.flat()
    .filter(i => i.title)
    .sort((a, b) => new Date(b.pubDate || 0) - new Date(a.pubDate || 0));

  const seen = new Set();
  const result = [];
  for (const item of flat) {
    // Google News 标题带 " - 媒体名" 后缀，拆掉
    const idx = item.title.lastIndexOf(' - ');
    const title = idx > 0 ? item.title.slice(0, idx) : item.title;
    const key = title.toLowerCase().slice(0, 60);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      rank: result.length + 1,
      title,
      url: item.link,
      hot: item.brand,
      platform: 'brands'
    });
    if (result.length >= 30) break;
  }
  return result;
}

// 3. TikTok 时尚媒体账号（尽力而为）
async function fetchTikTok(rssHub) {
  const all = await Promise.all(TIKTOK_ACCOUNTS.map(handle =>
    fetchRSS(`${rssHub}/tiktok/user/${handle}`, 8)
  ));
  const flat = all.flat().filter(i => i.title);
  const seen = new Set();
  const result = [];
  for (const item of flat) {
    const key = item.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      rank: result.length + 1,
      title: item.title,
      url: item.link,
      hot: '',
      platform: 'tiktok'
    });
    if (result.length >= 20) break;
  }
  return result;
}

// 4. X 热搜（按服装关键词过滤，尽力而为）
async function fetchTwitterFashion() {
  try {
    const res = await fetchWithTimeout('https://trends24.in/');
    const html = await res.text();
    const $ = cheerio.load(html);
    const trends = [];
    $('.trend-card__list li a, a[href*="twitter.com/search"], a[href*="x.com/search"]').each((i, el) => {
      const title = $(el).text().trim();
      if (title && title.length > 1 && !trends.find(t => t.title === title)) {
        trends.push(title);
      }
    });
    const filtered = trends.filter(t => {
      const lower = t.toLowerCase();
      return FASHION_KEYWORDS.some(k => lower.includes(k));
    });
    return filtered.slice(0, 20).map((title, index) => ({
      rank: index + 1,
      title,
      url: `https://x.com/search?q=${encodeURIComponent(title)}`,
      hot: '',
      platform: 'twitter'
    }));
  } catch (error) {
    console.error('Failed to fetch Twitter trends:', error.message);
    return [];
  }
}

async function getWorkingRSSHub() {
  for (const instance of RSSHUB_INSTANCES) {
    try {
      const res = await fetchWithTimeout(`${instance}/`, 5000);
      if (res.ok) return instance;
    } catch (e) { continue; }
  }
  return RSSHUB_INSTANCES[0];
}

async function main() {
  console.log('🚀 Starting to fetch fashion industry updates...');
  console.log(`📅 ${new Date().toISOString()}`);

  await fs.mkdir(DATA_DIR, { recursive: true });

  const rssHub = await getWorkingRSSHub();
  console.log(`📡 Using RSSHub: ${rssHub}`);

  const [news, brands, youtube, tiktok, twitter] = await Promise.all([
    fetchFashionNews(),
    fetchBrandPool(),
    fetchFashionYouTube(),
    fetchTikTok(rssHub),
    fetchTwitterFashion()
  ]);

  const data = {
    lastUpdated: new Date().toISOString(),
    platforms: {
      brands: { name: '品牌池动态', icon: '🔥', items: brands },
      news: { name: '行业资讯', icon: '📰', items: news },
      youtube: { name: 'YouTube 时尚频道', icon: '📺', items: youtube },
      tiktok: { name: 'TikTok 时尚', icon: '🎵', items: tiktok },
      twitter: { name: 'X 时尚热搜', icon: '𝕏', items: twitter }
    }
  };

  const outputPath = path.join(DATA_DIR, 'trending.json');
  await fs.writeFile(outputPath, JSON.stringify(data, null, 2), 'utf-8');

  console.log(`\n✅ Data saved to ${outputPath}`);
  console.log('📊 Summary:');
  Object.entries(data.platforms).forEach(([key, platform]) => {
    console.log(`   ${platform.icon} ${platform.name}: ${platform.items.length} items`);
  });
}

main().catch(console.error);
