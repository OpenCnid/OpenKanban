/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Flag console.log() calls (console.error/warn are allowed)',
    },
    messages: {
      noConsoleLog: [
        'Avoid console.log() in source files.',
        '',
        'WHY: console.log is debug noise. Use console.error for errors,',
        'console.warn for warnings. console.log should be removed before commit.',
        '',
        'FIX: Remove the log, or replace with console.error/console.warn',
        'if it captures a real error condition.',
      ].join('\n'),
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.object.type === 'Identifier' &&
          node.callee.object.name === 'console' &&
          node.callee.property.type === 'Identifier' &&
          node.callee.property.name === 'log'
        ) {
          context.report({ node, messageId: 'noConsoleLog' });
        }
      },
    };
  },
};
