import express from 'express';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import axios from 'axios';

const app = express();
app.use(express.json());

// ===== 创建 MCP 服务器实例 =====
const server = new McpServer({
  name: 'xhs-reader',
  version: '1.0.0'
});

// ===== 工具1：读取小红书帖子 =====
server.tool(
  "xhs_read",
  "读取小红书帖子内容（文字+图片）",
  {
    url: z.string().describe("帖子链接，支持 xhslink.com 短链或 xiaohongshu.com 完整链接"),
    include_images: z.boolean().optional().default(true).describe("是否包含图片，默认 true")
  },
  async ({ url, include_images = true }) => {
    try {
      // 1. 如果是 xhslink.com 短链，先获取重定向后的真实链接
      let realUrl = url;
      if (url.includes('xhslink.com')) {
        const resp = await axios.get(url, { maxRedirects: 0, validateStatus: (s) => s === 301 || s === 302 });
        realUrl = resp.headers.location;
        if (!realUrl) throw new Error('无法解析短链');
      }

      // 2. 请求小红书页面
      const pageResp = await axios.get(realUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      const html = pageResp.data;

      // 3. 提取 __INITIAL_STATE__ 中的 JSON 数据
      const match = html.match(/window\.__INITIAL_STATE__\s*=\s*({.*?});/s);
      if (!match) throw new Error('未找到初始化数据，可能页面结构已变更');
      const state = JSON.parse(match[1]);

      // 4. 解析内容
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

// ===== 配置 SSE 传输 =====
// 存储当前活跃的 transport（单客户端场景）
let currentTransport = null;

app.get('/sse', async (req, res) => {
  // 重要：在路由内部创建 transport，传入 res
  const transport = new SSEServerTransport('/message', res);
  currentTransport = transport; // 保存以便 /message 使用

  await server.connect(transport);
  transport.start(req, res);
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