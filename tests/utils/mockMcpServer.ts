export interface MockMcpServerConfig {
  command: string;
  args: string[];
  tools: string[];
}

export function createMockMcpServerConfig(serverName = 'mock-mcp'): MockMcpServerConfig {
  const script = `
process.stdin.setEncoding('utf8');
process.stdin.on('data', (data) => {
  const input = data.trim();
  if (!input) return;
  let message;
  try { message = JSON.parse(input); } catch { return; }
  if (message.method === 'tools/list') {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: message.id,
      result: { tools: [{ name: '${serverName}.echo', description: 'Mock MCP echo tool' }] }
    }) + '\\n');
    return;
  }
  process.stdout.write(JSON.stringify({
    jsonrpc: '2.0',
    id: message.id,
    result: { ok: true, method: message.method }
  }) + '\\n');
});
`;

  return {
    command: process.execPath,
    args: ['-e', script],
    tools: ['*'],
  };
}
