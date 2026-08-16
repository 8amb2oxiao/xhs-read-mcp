import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import axios from 'axios';

const app = express();

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }
  next();
});
app.use(express.json());

// ===== 创建 MCP 服务器 =====
const server = new McpServer({
  name: 'xhs-reader',
  version: '1.0.0'
});

// ===== 工具：读取小红书 =====
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
        const resp = await axios.get(url, { maxRedirects: 0, validateStatus: (s) => s === 301 || s === 302 });
        realUrl = resp.headers.location;
        if (!realUrl) throw new Error('无法解析短链');
      }
      const pageResp = await axios.get(realUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
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
        content: [{ type: 'text', text: JSON.stringify({ title, desc, images, url: realUrl }, null, 2) }]
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `读取失败：${error.message}` }],
        isError: true
      };
    }
  }
);

// ===== 占位工具 =====
server.tool(
  "chat_history",
  "获取会话历史（占位）",
  { session_id: z.string().optional() },
  async ({ session_id }) => ({
    content: [{ type: 'text', text: `会话 ${session_id || 'default'} 历史记录（占位）` }]
  })
);

// ===== 创建 transport =====
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: () => crypto.randomUUID()
});

// ===== 关键：让所有路径的GET和POST都返回标准MCP握手响应 =====
const mcpInitResponse = {
  jsonrpc: "2.0",
  id: 0,
  result: {
    protocolVersion: "1.0",
    serverInfo: { name: "xhs-reader", version: "1.0.0" },
    capabilities: { tools: {} }
  }
};

// 根路径：无论GET还是POST，都返回MCP握手响应
app.all('/', (req, res) => {
  res.json(mcpInitResponse);
});

// /mcp：GET返回握手响应，POST交给transport处理
app.all('/mcp', async (req, res) => {
  if (req.method === 'GET') {
    return res.json(mcpInitResponse);
  }
  try {
    await transport.handleRequest(req, res);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// /sse：同理
app.all('/sse', (req, res) => {
  if (req.method === 'POST') {
    return res.json(mcpInitResponse);
  }
  res.json(mcpInitResponse);
});

// 健康检查
app.get('/health', (req, res) => res.send('OK'));

// ===== 启动 =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ MCP server running on port ${PORT}`);
});