// 假接口：专门用来演练 DeepSeek 503「服务太忙」
// 用法：node tools/fake-503.mjs [port] [mode]
//   mode=flash-busy（默认）：deepseek-flash 一律 503，其它模型正常返回
//   mode=all-busy：所有模型都 503
import { createServer } from 'node:http';

const port = Number(process.argv[2] || 8899);
const mode = process.argv[3] || 'flash-busy';
let hits = 0;

const server = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    hits += 1;
    let model = '';
    try {
      model = JSON.parse(body || '{}').model || '';
    } catch {}
    const busy = mode === 'all-busy' || /flash/.test(model);
    console.log(`[fake] #${hits} ${req.method} ${req.url} model=${model} -> ${busy ? 503 : 200}`);
    if (busy) {
      res.writeHead(503, { 'content-type': 'application/json', 'retry-after': '1' });
      res.end(
        JSON.stringify({
          error: {
            message: 'Service is too busy. We advise users to temporarily switch to alternative LLM API service prov',
            type: 'server_error',
          },
        }),
      );
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        id: 'fake-1',
        model,
        choices: [{ index: 0, message: { role: 'assistant', content: '备用模型接上了，本鲸在。' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 12, completion_tokens: 9, total_tokens: 21 },
      }),
    );
  });
});

server.listen(port, '127.0.0.1', () => console.log(`[fake] listening on http://127.0.0.1:${port} mode=${mode}`));
