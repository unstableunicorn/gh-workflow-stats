import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {ignores: ['**/dist/', '**/node_modules/']},
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'Inject the clock: no new Date() below the wiring layer.'
        },
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: 'Inject the clock: no Date.now() below the wiring layer.'
        }
      ]
    }
  }
)
