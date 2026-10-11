import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default defineConfig(
  { ignores: ["**/dist/**", "**/node_modules/**", "experiments/**"] },
  js.configs.recommended,
  tseslint.configs.recommended,

  // core must stay deterministic and DOM-free (see docs/DESIGN.md §3.3).
  {
    files: ["packages/core/**/*.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        { object: "Math", property: "random", message: "Use the seeded Rng in core/src/rng.ts so runs stay deterministic." },
        { object: "Date", property: "now", message: "core must not read the wall clock. Use the tick count." },
      ],
      "no-restricted-globals": [
        "error",
        { name: "performance", message: "core must not read the wall clock. Use the tick count." },
        { name: "window", message: "core must stay DOM-free." },
        { name: "document", message: "core must stay DOM-free." },
      ],
    },
  },

  {
    files: ["packages/web/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
);
