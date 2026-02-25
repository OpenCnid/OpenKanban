/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Prevent direct orchestration calls outside the gateway client',
    },
    messages: {
      noDirectOrch: [
        'Direct orchestration API calls are not allowed outside src/lib/openclaw/.',
        '',
        'WHY: OpenClaw is the orchestrator. OpenKanban is the visual control surface.',
        'All orchestration (sessions, agents, cron, memory) MUST go through',
        'the gateway client at src/lib/openclaw/client.ts.',
        '',
        'FIX: Import and use the gateway client:',
        '  import { openclawClient } from "@/lib/openclaw/client";',
        '  await openclawClient.spawnSession({ task: "..." });',
        '',
        'REF: docs/architecture.md — "Core Principle"',
      ].join('\n'),
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename || context.getFilename();

    // Allow the gateway client itself and API routes that wrap it
    if (
      filename.includes('/lib/openclaw/') ||
      filename.includes('/app/api/')
    ) {
      return {};
    }

    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        // Flag direct imports of orchestration modules outside gateway
        if (
          source.includes('/orchestration') ||
          source.includes('/auto-dispatch')
        ) {
          context.report({ node, messageId: 'noDirectOrch' });
        }
      },
    };
  },
};
