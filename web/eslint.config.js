import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['**/dist', '**/src/gen', '**/*.gen.css', '**/node_modules'] },
  js.configs.recommended,
  tseslint.configs.strict,
  reactHooks.configs.flat.recommended,
  {
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off'
    }
  }
)
