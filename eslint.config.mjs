import js from "@eslint/js";
import tseslint from "typescript-eslint";
import sonarjs from "eslint-plugin-sonarjs";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.strict,
  sonarjs.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "sonarjs/no-clear-text-protocols": "off",
    },
  },
  {
    ignores: ["dist/", ".next/", "node_modules/", "*.config.*"],
  },
);
