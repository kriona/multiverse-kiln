import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Imports that would make game logic impure (CLAUDE.md architecture rule 4)
 */
const impureImports = [
	{ group: ['colyseus', '@colyseus/*'], message: 'Game logic must be pure: no Colyseus imports. Call logic from the room instead' },
	{ group: ['**/db/**', 'drizzle-orm', 'drizzle-orm/*', 'pg', 'postgres'], message: 'Game logic must be pure: no database access' },
	{ group: ['fs', 'http', 'https', 'net', 'express', 'node:*'], message: 'Game logic must be pure: no I/O or network access' }
];

/**
 * Imports that bypass the repository modules (CLAUDE.md database rules)
 */
const directDatabaseImports = [
	{ group: ['drizzle-orm', 'drizzle-orm/*', 'pg', 'postgres', '**/db/client*'], message: 'Rooms must go through repository modules in server/src/db/, not the database client directly' }
];

export default defineConfig(
	globalIgnores([
		'**/node_modules/',
		'**/build/',
		'**/dist/',
		// Colyseus Cloud entry point and deployment config; left as Colyseus generated them
		'server/src/index.ts',
		'server/ecosystem.config.cjs',
		// Third-party agent skills, installed and updated by `npx skills`
		'.agents/'
	]),

	js.configs.recommended,
	tseslint.configs.recommendedTypeChecked,

	{
		languageOptions: {
			parserOptions: {
				// Uses the nearest tsconfig.json for each file
				projectService: true,
				tsconfigRootDir: import.meta.dirname
			}
		}
	},

	// Code style (see the global CLAUDE.md). Return-value and ternary parentheses have no rule and stay manual
	{
		plugins: {
			'@stylistic': stylistic
		},
		rules: {
			'@stylistic/brace-style': ['error', 'allman'],
			'@stylistic/quotes': ['error', 'single', { allowTemplateLiterals: 'always' }],
			'@stylistic/indent': ['error', 'tab'],
			'@stylistic/semi': ['error', 'always'],
			'@stylistic/no-multi-spaces': 'error',
			'@stylistic/no-trailing-spaces': 'error',
			'@stylistic/eol-last': ['error', 'always'],
			'curly': ['error', 'all'],
			'eqeqeq': ['error', 'always']
		}
	},

	{
		rules: {
			'@typescript-eslint/no-explicit-any': 'error',
			'@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
			'@typescript-eslint/no-unused-vars': ['error', { args: 'after-used', argsIgnorePattern: '^_' }]
		}
	},

	{
		files: ['client/**/*.ts'],
		ignores: ['client/vite.config.ts'],
		languageOptions: {
			globals: globals.browser
		}
	},

	{
		files: ['server/**/*.ts', 'shared/**/*.ts', 'client/vite.config.ts'],
		languageOptions: {
			globals: globals.node
		}
	},

	{
		files: ['server/test/**/*.ts'],
		languageOptions: {
			globals: globals.mocha
		}
	},

	{
		files: ['server/src/logic/**/*.ts'],
		rules: {
			'no-restricted-imports': ['error', { patterns: impureImports }]
		}
	},

	{
		files: ['server/src/rooms/**/*.ts'],
		rules: {
			'no-restricted-imports': ['error', { patterns: directDatabaseImports }]
		}
	},

	// Plain JavaScript config files aren't in a tsconfig, so skip the type-aware rules there
	{
		files: ['**/*.js', '**/*.cjs', '**/*.mjs'],
		extends: [tseslint.configs.disableTypeChecked],
		languageOptions: {
			globals: globals.node
		}
	}
);
