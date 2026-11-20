import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { assets, fingerprints, slug, validate } from './lab-core.mjs';

const server = new McpServer({ name: 'chemistry-lab', version: '1.0.0' });
const id = z.string().regex(slug);
const ok = value => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: value });
const handle = fn => args => {
  try { return ok(fn(args)); }
  catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; }
};

server.registerTool('list_assets', {
  description: 'Search reusable Blender and GLB apparatus by id or name before making a new asset.',
  annotations: { readOnlyHint: true },
  inputSchema: { query: z.string().max(100).optional() }
}, handle(({ query = '' }) => ({ assets: assets().filter(a => `${a.id} ${a.title}`.toLowerCase().includes(query.toLowerCase())) })));

server.registerTool('validate_experiment', {
  description: 'Check references, steps and current approval status for a draft or published configuration.',
  annotations: { readOnlyHint: true },
  inputSchema: { id }
}, handle(({ id }) => validate(id)));

server.registerTool('review_fingerprints', {
  description: 'Get current review fingerprints. This does not approve or publish the project.',
  annotations: { readOnlyHint: true },
  inputSchema: { id }
}, handle(({ id }) => fingerprints(id)));

await server.connect(new StdioServerTransport());
