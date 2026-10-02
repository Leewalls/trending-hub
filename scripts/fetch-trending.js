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
  'streetwear trend OR "streetwear brand" OR hypebeast',
  'menswear trend OR "men\'s fashion" OR "men clothing"',
  'fashion resale OR thrift OR vintage clothing OR "secondhand fashion"',
  'sneaker drop OR streetwear drop OR "brand collab" OR capsule collection',
  '"hip hop fashion" OR rapper clothing line OR "celebrity wore"',
];

// 品牌词库（从 data/brand-library.json 读取，风向情报项目共用同一份库）
import fsSync from 'fs';
const BRAND_LIBRARY = JSON.parse(
  fsSync.readFileSync(path.join(__dirname, '..', 'data', 'brand-library.json'), 'utf-8')
);
const BRAND_POOL = BRAND_LIBRARY.brands.map(b => ({
  label: b.label,
  query: b.query,
  aliases: b.aliases || [],
  category: b.category || '',
  dh_verified: !!b.dh_verified
}));

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

// 通用 RSS 解析（兼容 RSS <item> 和 Atom <entry>，失败自动重试一次）
async function fetchRSS(url, maxItems = 20) {
  for (let attempt = 1; attempt <= 2; attempt++) {
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
      if (items.length > 0 || attempt === 2) return items;
    } catch (error) {
      if (attempt === 2) console.error(`Failed to fetch ${url}:`, error.message);
    }
  }
  return [];
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

// 低行动价值噪音（标题命中即丢弃，不进简报）
const NOISE_PATTERNS = [
  /BoF 500/i,
  /The People Shaping the Global Fashion Industry/i,
];

// ---- 新品牌发现：从资讯标题里自动提取词库外的品牌名 ----
const DISCOVERY_CONTEXT = /brand|drop|collab|collection|sneaker|hoodie|tee|streetwear|label|launch|release|resell|resale|capsule|wore|wearing|debut/i;

// 已知非品牌词（人名/地名/通用词，命中即跳过）
const NON_BRAND_WORDS = new Set([
  'nike','adidas','puma','vogue','wwd','guardian','reuters','forbes','google','youtube',
  'paris','london','tokyo','japan','china','italy','milan','korea','korean','india',
  'american','british','french','italian','japanese','national','fashion','week',
  'complexcon','met','oscars','grammys','nfl','nba','mlb','fifa','olympic',
  'january','february','march','april','june','july','august','september','october','november','december',
  'monday','tuesday','wednesday','thursday','friday','saturday','sunday',
  'joe','trump','biden','kanye','kim','rihanna','beyonce','taylor','drake','jay',
  'gen','ai','us','uk','eu','nyc','la','lvmh','kering',
  // 常见通用词（会以首字母大写形式出现在标题里）
  'collection','capsule','guide','edition','exclusive','review','look','looks',
  'out','outfit','outfits','new','best','top','sale','shop','store','online',
  'street','style','styles','wear','clothing','dress','dresses','shirt','shirts',
  'hoodie','hoodies','sneaker','sneakers','shoes','boots','denim','jeans',
  'jacket','jackets','coat','coats','pants','shorts','sweater','knit','bag','bags',
  'watch','watches','spring','summer','fall','winter','resort','prefall',
  'festival','tour','show','shows','runway','market','industry','business',
  'daily','post','times','magazine','journal','news','report','reports',
  'standing','coming','going','making','building','trying','getting',
]);

// 从标题提取候选品牌名（1-3个首字母大写词的组合）
function extractBrandCandidates(titles, knownBrandWords) {
  const counter = new Map();
  for (const raw of titles) {
    if (!DISCOVERY_CONTEXT.test(raw)) continue;
    // 匹配连续的、每个词都首字母大写的 1-3 词组合
    const matches = raw.matchAll(/\b([A-Z][a-zA-Z&0-9']{1,15}(?:\s+(?:[A-Z][a-zA-Z&0-9']{1,15}|\d+)){0,2})\b/g);
    for (const m of matches) {
      const candidate = m[1].trim();
      const words = candidate.toLowerCase().split(/\s+/);
      // 跳过：包含已知品牌词、非品牌词、或纯数字
      if (words.some(w => knownBrandWords.has(w) || NON_BRAND_WORDS.has(w) || /^\d+$/.test(w))) continue;
      // 单词候选必须够独特（首字母大写专名），双词组合最可靠
      if (words.length === 1 && candidate.length < 4) continue;
      const key = candidate;
      if (!counter.has(key)) counter.set(key, { count: 0, sample: raw.slice(0, 100) });
      counter.get(key).count++;
    }
  }
  return counter;
}

async function discoverBrands(newsItems, youtubeItems, brandItems) {
  const knownBrandWords = new Set();
  for (const b of BRAND_POOL) {
    // 已知品牌的查询词和别名拆成单词，用于排除
    (b.query.toLowerCase().match(/[a-z0-9]+/g) || []).forEach(w => knownBrandWords.add(w));
    (b.aliases || []).forEach(a => (a.toLowerCase().match(/[a-z0-9]+/g) || []).forEach(w => knownBrandWords.add(w)));
    b.label.toLowerCase().match(/[a-z0-9]+/g).forEach(w => knownBrandWords.add(w));
  }

  const titles = [
    ...newsItems.map(i => i.title),
    ...youtubeItems.map(i => i.title),
    ...brandItems.map(i => i.title),
  ];
  const counter = extractBrandCandidates(titles, knownBrandWords);

  // 合并历史发现（data/discovered-brands.json，Actions 每次运行会提交回仓库，长期累积）
  const discPath = path.join(DATA_DIR, 'discovered-brands.json');
  let history = {};
  try { history = JSON.parse(await fs.readFile(discPath, 'utf-8')); } catch {}

  for (const [name, info] of counter) {
    if (!history[name]) history[name] = { totalMentions: 0, firstSeen: new Date().toISOString(), sample: info.sample };
    history[name].totalMentions += info.count;
    history[name].lastSeen = new Date().toISOString();
  }

  // 只保留提及 >= 2 次的，按总提及排序
  const sorted = Object.entries(history)
    .filter(([, v]) => v.totalMentions >= 2)
    .sort((a, b) => b[1].totalMentions - a[1].totalMentions)
    .slice(0, 60);
  await fs.writeFile(discPath, JSON.stringify(Object.fromEntries(sorted), null, 2), 'utf-8');

  return sorted.slice(0, 15).map(([name, v], index) => ({
    rank: index + 1,
    title: name,
    url: `https://news.google.com/search?q=${encodeURIComponent(name + ' fashion')}&hl=en-US`,
    hot: `累计提及 ${v.totalMentions} 次`,
    platform: 'discovery'
  }));
}

// 1. 行业资讯（Google News，多查询合并去重）
async function fetchFashionNews() {
  const seen = new Set();
  const merged = [];
  const all = await Promise.all(NEWS_QUERIES.map(q =>
    fetchRSS(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`, 40)
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
      // 过滤低行动价值噪音
      if (NOISE_PATTERNS.some(p => p.test(title))) continue;
      const key = title.toLowerCase().slice(0, 60);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push({ title, source, url: item.link, pubDate: item.pubDate });
    }
  }
  return merged.slice(0, 50).map((item, index) => ({
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
      12
    );
    return items.map(item => ({
      ...item,
      brand: brand.label,
      category: brand.category,
      dh_verified: brand.dh_verified
    }));
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
      category: item.category,
      dh_verified: item.dh_verified,
      pubDate: item.pubDate,
      platform: 'brands'
    });
    if (result.length >= 40) break;
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

  const discovery = await discoverBrands(news, youtube, brands);

  const data = {
    lastUpdated: new Date().toISOString(),
    platforms: {
      brands: { name: '品牌池动态', icon: '🔥', items: brands },
      discovery: { name: '新品牌发现', icon: '🧭', items: discovery },
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
