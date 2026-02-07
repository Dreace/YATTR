import js from "@eslint/js";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "@typescript-eslint/eslint-plugin";
import parser from "@typescript-eslint/parser";

export default [
  {
    ignores: ["dist/**", "coverage/**"],
  },
  js.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser,
      parserOptions: { ecmaVersion: 2020, sourceType: "module", ecmaFeatures: { jsx: true } },
      globals: {
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        localStorage: "readonly",
        URL: "readonly",
        Blob: "readonly",
        File: "readonly",
        FormData: "readonly",
        URLSearchParams: "readonly",
        HTMLElement: "readonly",
        HTMLAnchorElement: "readonly",
        HTMLInputElement: "readonly",
        KeyboardEvent: "readonly",
      },
    },
    plugins: { "@typescript-eslint": tseslint, react, "react-hooks": reactHooks },
    settings: { react: { version: "detect" } },
    rules: {
      "react/react-in-jsx-scope": "off",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "off",
    },
  },
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "src/test/**/*.ts"],
    languageOptions: {
      globals: {
        it: "readonly",
        expect: "readonly",
        afterEach: "readonly",
        process: "readonly",
      },
    },
  },
];
