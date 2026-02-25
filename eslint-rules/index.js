const noDirectOrchestration = require('./rules/no-direct-orchestration');
const noConsoleLog = require('./rules/no-console-log');

module.exports = {
  rules: {
    'no-direct-orchestration': noDirectOrchestration,
    'no-console-log': noConsoleLog,
  },
};
