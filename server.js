import express from 'express';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import axios from 'axios';

const app = express();

// ===== CORS 中间件 =====
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

// ===== 健康检查端点（让前端测试通过） =====
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'xhs-read-mcp' });
});

app.get('/health', (req, res) => {
  res.send('OK');
});

// ===== 创建 MCP 服务器 =====
const server = new McpServer({
  name: 'xhs-reader',
  version: '1.0.0'
});

// ===== 工具1：读取小红书 =====
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
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
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
        content: [
          { type: 'text', text: JSON.stringify({ title, desc, images, url: realUrl }, null, 2) }
        ]
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `读取失败：${error.message}` }],
        isError: true
      };
    }
  }
);

// ===== 工具2：聊天历史（占位） =====
server.tool(
  "chat_history",
  "获取会话历史（占位）",
  { session_id: z.string().optional() },
  async ({ session_id }) => {
    return {
      content: [{ type: 'text', text: `会话 ${session_id || 'default'} 历史记录（占位）` }]
    };
  }
);

// ===== SSE 传输（修正后） =====
let currentTransport = null;

app.get('/sse', async (req, res) => {
  currentTransport = new SSEServerTransport('/message', res);
  await server.connect(currentTransport); // 这里自动调用 start，不要重复调用
});

app.post('/message', async (req, res) => {
  if (currentTransport) {
    await currentTransport.handlePostMessage(req, res);
  } else {
    res.status(400).send('No active SSE session');
  }
});

// ===== 启动服务器 =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ MCP SSE server running on port ${PORT}`);
  console.log(`📍 SSE endpoint: /sse`);
  console.log(`📍 Message endpoint: /message`);
});