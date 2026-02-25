const { RuleTester } = require('eslint');
const rule = require('../rules/no-direct-orchestration');

const tester = new RuleTester({ parserOptions: { ecmaVersion: 2022, sourceType: 'module' } });

tester.run('no-direct-orchestration', rule, {
  valid: [
    // Gateway client itself is allowed
    { code: 'import { something } from "./utils";', filename: 'src/lib/openclaw/client.ts' },
    // API routes are allowed (they wrap the client)
    { code: 'import { orchestrate } from "@/lib/orchestration";', filename: 'src/app/api/tasks/route.ts' },
    // Normal imports from components
    { code: 'import { Button } from "@/components/ui/button";', filename: 'src/components/Pipeline.tsx' },
    // Importing gateway client is fine
    { code: 'import { openclawClient } from "@/lib/openclaw/client";', filename: 'src/components/Pipeline.tsx' },
  ],
  invalid: [
    {
      code: 'import { logActivity } from "@/lib/orchestration";',
      filename: 'src/components/TaskCard.tsx',
      errors: [{ messageId: 'noDirectOrch' }],
    },
    {
      code: 'import { autoDispatch } from "@/lib/auto-dispatch";',
      filename: 'src/hooks/useTaskActions.ts',
      errors: [{ messageId: 'noDirectOrch' }],
    },
  ],
});

console.log('✅ no-direct-orchestration: all tests passed');
