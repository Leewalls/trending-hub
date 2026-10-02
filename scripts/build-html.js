import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

async function buildHTML() {
  // 读取数据
  const dataPath = path.join(DATA_DIR, 'trending.json');
  let data;
  
  try {
    const raw = await fs.readFile(dataPath, 'utf-8');
    data = JSON.parse(raw);
  } catch (error) {
    console.error('No data found, creating placeholder...');
    data = {
      lastUpdated: new Date().toISOString(),
      platforms: {}
    };
  }
  
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>服装行业雷达 - Fashion Radar</title>
  <meta name="description" content="实时聚合服装领域的行业资讯、YouTube、TikTok、X 动态">
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>👗</text></svg>">
  <style>
    :root {
      --bg-primary: #0f0f0f;
      --bg-secondary: #1a1a1a;
      --bg-card: #242424;
      --text-primary: #ffffff;
      --text-secondary: #a0a0a0;
      --accent: #ff6b35;
      --accent-hover: #ff8c5a;
      --border: #333333;
      --twitter: #1da1f2;
      --tiktok: #ff0050;
      --bilibili: #00a1d6;
      --youtube: #ff0000;
      --instagram: #e1306c;
      --weibo: #e6162d;
      --zhihu: #0066ff;
      --baidu: #2932e1;
      --douyin: #000000;
    }
    
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      line-height: 1.6;
      min-height: 100vh;
    }
    
    .header {
      background: linear-gradient(135deg, var(--bg-secondary) 0%, var(--bg-primary) 100%);
      padding: 2rem;
      text-align: center;
      border-bottom: 1px solid var(--border);
      position: sticky;
      top: 0;
      z-index: 100;
      backdrop-filter: blur(10px);
    }
    
    .header h1 {
      font-size: 2rem;
      margin-bottom: 0.5rem;
      background: linear-gradient(135deg, var(--accent) 0%, #ff9f7a 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    
    .header .subtitle {
      color: var(--text-secondary);
      font-size: 0.9rem;
    }
    
    .last-updated {
      margin-top: 0.5rem;
      font-size: 0.8rem;
      color: var(--text-secondary);
    }
    
    .tabs {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      padding: 1rem 2rem;
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border);
      justify-content: center;
    }
    
    .tab {
      padding: 0.5rem 1rem;
      border: 1px solid var(--border);
      border-radius: 20px;
      background: var(--bg-card);
      color: var(--text-secondary);
      cursor: pointer;
      transition: all 0.3s ease;
      font-size: 0.9rem;
    }
    
    .tab:hover {
      border-color: var(--accent);
      color: var(--text-primary);
    }
    
    .tab.active {
      background: var(--accent);
      border-color: var(--accent);
      color: white;
    }
    
    .container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 2rem;
    }
    
    .platforms-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
      gap: 1.5rem;
    }
    
    .platform-card {
      background: var(--bg-card);
      border-radius: 12px;
      overflow: hidden;
      border: 1px solid var(--border);
      transition: transform 0.3s ease, box-shadow 0.3s ease;
    }
    
    .platform-card:hover {
      transform: translateY(-5px);
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
    }
    
    .platform-card.hidden {
      display: none;
    }
    
    .platform-header {
      padding: 1rem 1.5rem;
      display: flex;
      align-items: center;
      gap: 0.75rem;
      border-bottom: 1px solid var(--border);
    }
    
    .platform-header.twitter { border-left: 4px solid var(--twitter); }
    .platform-header.tiktok { border-left: 4px solid var(--tiktok); }
    .platform-header.bilibili { border-left: 4px solid var(--bilibili); }
    .platform-header.youtube { border-left: 4px solid var(--youtube); }
    .platform-header.instagram { border-left: 4px solid var(--instagram); }
    .platform-header.weibo { border-left: 4px solid var(--weibo); }
    .platform-header.zhihu { border-left: 4px solid var(--zhihu); }
    .platform-header.baidu { border-left: 4px solid var(--baidu); }
    .platform-header.douyin { border-left: 4px solid var(--douyin); }
    .platform-header.toutiao { border-left: 4px solid #ff4500; }
    .platform-header.news { border-left: 4px solid #4285f4; }
    
    .platform-icon {
      font-size: 1.5rem;
    }
    
    .platform-name {
      font-weight: 600;
      font-size: 1.1rem;
    }
    
    .platform-count {
      margin-left: auto;
      font-size: 0.8rem;
      color: var(--text-secondary);
      background: var(--bg-secondary);
      padding: 0.25rem 0.5rem;
      border-radius: 10px;
    }
    
    .trending-list {
      max-height: 400px;
      overflow-y: auto;
    }
    
    .trending-list::-webkit-scrollbar {
      width: 6px;
    }
    
    .trending-list::-webkit-scrollbar-track {
      background: var(--bg-secondary);
    }
    
    .trending-list::-webkit-scrollbar-thumb {
      background: var(--border);
      border-radius: 3px;
    }
    
    .trending-item {
      display: flex;
      align-items: center;
      padding: 0.75rem 1.5rem;
      gap: 1rem;
      border-bottom: 1px solid var(--border);
      transition: background 0.2s ease;
      text-decoration: none;
      color: inherit;
    }
    
    .trending-item:hover {
      background: var(--bg-secondary);
    }
    
    .trending-item:last-child {
      border-bottom: none;
    }
    
    .rank {
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.8rem;
      font-weight: 600;
      border-radius: 4px;
      background: var(--bg-secondary);
      color: var(--text-secondary);
      flex-shrink: 0;
    }
    
    .rank.top3 {
      background: var(--accent);
      color: white;
    }
    
    .trending-title {
      flex: 1;
      font-size: 0.9rem;
      line-height: 1.4;
      word-break: break-word;
    }
    
    .no-data {
      padding: 2rem;
      text-align: center;
      color: var(--text-secondary);
    }
    
    .footer {
      text-align: center;
      padding: 2rem;
      color: var(--text-secondary);
      font-size: 0.85rem;
      border-top: 1px solid var(--border);
      margin-top: 2rem;
    }
    
    .footer a {
      color: var(--accent);
      text-decoration: none;
    }
    
    .refresh-notice {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      background: var(--bg-card);
      padding: 0.5rem 1rem;
      border-radius: 20px;
      font-size: 0.8rem;
      margin-top: 1rem;
    }
    
    .pulse {
      width: 8px;
      height: 8px;
      background: #4ade80;
      border-radius: 50%;
      animation: pulse 2s infinite;
    }
    
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    
    @media (max-width: 768px) {
      .header h1 {
        font-size: 1.5rem;
      }
      
      .platforms-grid {
        grid-template-columns: 1fr;
      }
      
      .tabs {
        padding: 1rem;
      }
      
      .container {
        padding: 1rem;
      }
    }
  </style>
</head>
<body>
  <header class="header">
    <h1>👗 服装行业雷达 Fashion Radar</h1>
    <p class="subtitle">追踪服装领域的行业资讯与海外社媒动态</p>
    <p class="last-updated">最后更新: <span id="lastUpdated">${new Date(data.lastUpdated).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</span></p>
    <div class="refresh-notice">
      <span class="pulse"></span>
      每30分钟自动刷新
    </div>
  </header>
  
  <nav class="tabs">
    <button class="tab active" data-platform="all">全部</button>
    ${Object.entries(data.platforms).map(([key, platform]) => `
    <button class="tab" data-platform="${key}">${platform.icon} ${platform.name}</button>
    `).join('')}
  </nav>
  
  <main class="container">
    <div class="platforms-grid">
      ${Object.entries(data.platforms).map(([key, platform]) => `
      <div class="platform-card" data-platform="${key}">
        <div class="platform-header ${key}">
          <span class="platform-icon">${platform.icon}</span>
          <span class="platform-name">${platform.name}</span>
          <span class="platform-count">${platform.items.length} 条</span>
        </div>
        <div class="trending-list">
          ${platform.items.length > 0 ? platform.items.map(item => `
          <a href="${item.url}" target="_blank" rel="noopener noreferrer" class="trending-item">
            <span class="rank ${item.rank <= 3 ? 'top3' : ''}">${item.rank}</span>
            <span class="trending-title">${escapeHtml(item.title)}</span>
          </a>
          `).join('') : `
          <div class="no-data">暂无数据</div>
          `}
        </div>
      </div>
      `).join('')}
    </div>
  </main>
  
  <footer class="footer">
    <p>数据来源: RSSHub, trends24.in, top-hashtags.com 等公开数据源</p>
    <p>Powered by <a href="https://github.com" target="_blank">GitHub Actions</a> | 开源项目</p>
  </footer>
  
  <script>
    // Tab 切换
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        
        const platform = tab.dataset.platform;
        document.querySelectorAll('.platform-card').forEach(card => {
          if (platform === 'all' || card.dataset.platform === platform) {
            card.classList.remove('hidden');
          } else {
            card.classList.add('hidden');
          }
        });
      });
    });
    
    // 自动刷新页面 (30分钟)
    setTimeout(() => {
      location.reload();
    }, 30 * 60 * 1000);
  </script>
</body>
</html>`;

  function escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
  
  // 确保目录存在
  await fs.mkdir(PUBLIC_DIR, { recursive: true });
  
  // 写入 HTML
  const outputPath = path.join(PUBLIC_DIR, 'index.html');
  await fs.writeFile(outputPath, html, 'utf-8');
  
  console.log(`✅ HTML built: ${outputPath}`);
}

buildHTML().catch(console.error);
