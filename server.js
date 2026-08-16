import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import axios from 'axios';

const app = express();

// ===== 1. 关键：强制设置 Accept 头 =====
// 这是从参考代码中学到的核心技巧，很多前端靠这个头来识别 MCP 服务
const ensureMcpAcceptHeader = (req) => {
  const desired = 'application/json, text/event-stream';
  const accept = String(req.headers.accept || '');
  if (accept.includes('application/json') && accept.includes('text/event-stream')) {
    return;
  }
  req.headers.accept = desired;
};

// ===== 2. 中间件：CORS + 强制 Accept 头 =====
app.use((req, res, next) => {
  // 强制设置 Accept 头，让前端能正确识别
  ensureMcpAcceptHeader(req);
  
  // CORS 配置
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }
  next();
});
app.use(express.json());

// ===== 3. 创建 MCP 服务器并注册工具 =====
const server = new McpServer({
  name: 'xhs-reader',
  version: '1.0.0'
});

server.tool(
  "xhs_read",
  "读取小红书帖子内容（文字+图片）",
  {
    url: z.string().describe("帖子链接，支持 xhslink.com 短链或 xiaohongshu.com 完整链接"),
    include_images: z.boolean().optional().default(true).describe("是否包含图片，默认 true")
  },
  async ({ url, include_images = true }) => {
    try {
      let realUrl = url;
      if (url.includes('xhslink.com')) {
        const resp = await axios.get(url, { 
          maxRedirects: 0, 
          validateStatus: (s) => s === 301 || s === 302 
        });
        realUrl = resp.headers.location;
        if (!realUrl) throw new Error('无法解析短链');
      }
      const pageResp = await axios.get(realUrl, {
        headers: { 
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' 
        }
      });
      const html = pageResp.data;
      const match = html.match(/window\.__INITIAL_STATE__\s*=\s*({.*?});/s);
      if (!match) throw new Error('未找到初始化数据');
      const state = JSON.parse(match[1]);
      const note = state.note?.noteDetailMap?.[state.note?.noteId] || {};
      const title = note.title || '';
      const desc = note.desc || '';
      const images = include_images ? (note.imageList || []).map(img => img.url) : [];

      return {
        content: [{ 
          type: 'text', 
          text: JSON.stringify({ title, desc, images, url: realUrl }, null, 2) 
        }]
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `读取失败：${error.message}` }],
        isError: true
      };
    }
  }
);

// ===== 4. 使用 StreamableHTTPServerTransport =====
// 这是参考代码推荐的方式，能同时处理 SSE 和普通 HTTP 请求
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: () => crypto.randomUUID()
});

// ===== 5. 关键：让根路径和 /mcp 都使用 transport 处理 =====
// 这样无论前端访问哪个路径，都能得到正确的 MCP 协议响应
app.all('/mcp', async (req, res) => {
  try {
    await transport.handleRequest(req, res);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 根路径也指向 /mcp，兼容不同的前端配置习惯
app.all('/', async (req, res) => {
  try {
    await transport.handleRequest(req, res);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== 6. 健康检查（可选） =====
app.get('/health', (req, res) => res.send('OK'));

// ===== 7. 启动服务器 =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ MCP server running on port ${PORT}`);
  console.log(`📍 Endpoint: /mcp or /`);
});