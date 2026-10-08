import tseslint from 'typescript-eslint';

// src/fbl is a copy of the Visual Studio Code host's FBL library and is never edited here, so it is
// not linted here either: a finding in it goes to that repository.
export default tseslint.config(
  { ignores: ['dist', 'node_modules', '.wrangler', 'src/fbl', 'test/examples', 'test/fixtures'] },
  ...tseslint.configs.recommended,
);
