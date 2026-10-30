import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  {
    // Site-builder runtime files are NOT part of this app: they are copied
    // verbatim into every generated clone/SEO site (a separate Next.js app,
    // see scripts/bundle-runtime-files.cjs), which runs them as plain Node
    // CommonJS (deploy/*), a standalone browser script (public/sb-effects.js)
    // or that app's own pages. Linting them with this app's rules fails
    // `next build` on rules that don't apply there (require(), <a> to "/").
    ignores: [
      "src/features/site-builder/deploy/**",
      "src/features/site-builder/templates/**",
      "src/features/site-builder/server/generated/**",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];

export default eslintConfig;
