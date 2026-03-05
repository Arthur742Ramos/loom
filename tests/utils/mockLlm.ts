export interface MockLlmEvent {
  type: 'status' | 'chunk' | 'done' | 'error';
  content?: string;
  status?: string;
}

export function buildMockLlmStream(prompt: string): MockLlmEvent[] {
  const content = `Mock response: ${prompt}`;
  return [
    { type: 'status', status: 'Running mocked response' },
    { type: 'chunk', content },
    { type: 'done', content },
  ];
}
