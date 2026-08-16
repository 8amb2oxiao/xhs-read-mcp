import express from 'express';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { readXHS } from './xhs_read_snippet.js'; // 根据你的实际导出调整

const app = express();
app.use(express.json());

const server = new McpServer({
  name: 'xhs-reader',
  version: '1.0.0'
});

server.tool(
  'xhs_read',
  '读取小红书帖子内容（文字+图片）',
  { 
    url: z.string().describe('小红书帖子链接，支持 xhslink.com 短链或 xiaohongshu.com 完整链接'),
    include_images: z.boolean().optional().default(true).describe('是否包含图片，默认 true')
  },
  async ({ url, include_images = true }) => {
    try {
      const result = await readXHS(url, include_images);
      return {
        content: [
          { type: 'text', text: JSON.stringify(result, null, 2) }
        ]
      };
    } catch (error) {
      return {
        content: [
          { type: 'text', text: `读取失败：${error.message}` }
        ],
        isError: true
      };
    }
  }
);

// 创建 SSE 传输
const transport = new SSEServerTransport('/message', app);

app.get('/sse', async (req, res) => {
  await server.connect(transport);
  transport.start(req, res);
});

app.post('/message', async (req, res) => {
  await transport.handlePostMessage(req, res);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ MCP SSE server running on port ${PORT}`);
  console.log(`📍 SSE endpoint: /sse`);
  console.log(`📍 Message endpoint: /message`);
});