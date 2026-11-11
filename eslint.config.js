import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

// §21.7: values never reach SQL text. A template literal passed to query() may only interpolate SQL *fragments*:
// UPPER_CASE constants, the Where builder's placeholders ($n) and whitelisted sort/column maps, or literal-only choices.
// Anything else (e.g. `${email}`, `${req.body.x}`) is reported.
const FRAGMENT = /^([A-Z][A-Z0-9_]*|where|limit|offset|order|filter|base|sets|params|w|cw|nowP)$/;
function isFragment(n) {
  switch (n.type) {
    case 'Literal':
      return true;
    case 'Identifier':
      return FRAGMENT.test(n.name);
    case 'MemberExpression':
      return isFragment(n.object); // SORTS[q.sort] picks from a whitelist; params.length is a placeholder index
    case 'CallExpression':
      return isFragment(n.callee) && n.arguments.every(isFragment); // w.sql(), sets.join(', '), COUNTS.replaceAll('$NOW', nowP)
    case 'LogicalExpression':
      return isFragment(n.left) && isFragment(n.right);
    case 'ConditionalExpression':
      return isFragment(n.consequent) && isFragment(n.alternate);
    default:
      return false;
  }
}
const sqlNoValues = {
  meta: { type: 'problem', messages: { value: 'Use positional parameters ($1) instead of interpolating values into SQL.' } },
  create(context) {
    return {
      "CallExpression[callee.property.name='query'] > TemplateLiteral"(node) {
        for (const e of node.expressions) if (!isFragment(e)) context.report({ node: e, messageId: 'value' });
      },
    };
  },
};

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '.localdb/**', 'e2e/playwright-report/**', 'frontend/public/sw.js'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['backend/src/**/*.ts'],
    plugins: { campushub: { rules: { 'sql-no-values': sqlNoValues } } },
    rules: { 'campushub/sql-no-values': 'error' },
  },
  {
    files: ['frontend/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'warn' },
  },
);
