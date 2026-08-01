/**
 * ESM resolver hook so test scripts can import the app's REAL TypeScript
 * sources under `node --experimental-strip-types`.
 *
 * Node strips types but keeps Node resolution semantics, which don't know two
 * things TypeScript allows:
 *   1. the `@/…` path alias from tsconfig
 *   2. extensionless relative imports (`./foo` → `./foo.ts`)
 *
 * Used via scripts/ts-register.mjs.
 */
const ROOT = new URL("../", import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  const spec = specifier.startsWith("@/")
    ? new URL(specifier.slice(2), ROOT).href
    : specifier;

  try {
    return await nextResolve(spec, context);
  } catch (err) {
    for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
      try {
        return await nextResolve(spec + ext, context);
      } catch {
        /* try the next candidate */
      }
    }
    throw err;
  }
}
