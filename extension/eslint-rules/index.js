import noAct from './no-act.js';
import topLevelListeners from './top-level-listeners.js';

/** Local ESLint plugin: Attest's custom rules. */
const plugin = {
  meta: { name: 'eslint-plugin-attest', version: '1.0.0' },
  rules: {
    'no-act': noAct,
    'top-level-listeners': topLevelListeners,
  },
};

export default plugin;
