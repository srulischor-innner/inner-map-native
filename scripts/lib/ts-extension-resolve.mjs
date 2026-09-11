// ESM resolve hook: let a check import the app's own TypeScript modules.
//
// Node 24 strips types on its own, so `import x from '../utils/foo.ts'` works —
// but a .ts file that itself imports a sibling WITHOUT an extension
// (guideContent.ts does: `from '../constants/features'`) fails resolution, and
// there is no flag for it any more. This appends .ts on a miss so a check can
// read the real exported constants instead of grepping the source.
//
// Used by scripts/check-guide-matches-app.mjs via module.register().
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      return await next(specifier + '.ts', context);
    }
    throw err;
  }
}
