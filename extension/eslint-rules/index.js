import coreDeterminism from './core-determinism.js';
import logCall from './log-call.js';
import noAct from './no-act.js';
import noNetwork from './no-network.js';
import topLevelListeners from './top-level-listeners.js';

/** Local ESLint plugin: Attest's custom rules. */
const plugin = {
  meta: { name: 'eslint-plugin-attest', version: '1.1.0' },
  rules: {
    'core-determinism': coreDeterminism,
    'log-call': logCall,
    'no-act': noAct,
    'no-network': noNetwork,
    'top-level-listeners': topLevelListeners,
  },
};

export default plugin;
