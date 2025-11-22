const truthy = (value) => ['true', '1', 'yes'].includes((value || '').toLowerCase());

// Skip Husky install in CI, ToDesktop installer phases, and production/opt-out
if (
  truthy(process.env.CI) ||
  truthy(process.env.TODESKTOP_CI) ||
  truthy(process.env.TODESKTOP_INITIAL_INSTALL_PHASE) ||
  process.env.NODE_ENV === 'production' ||
  process.env.HUSKY === '0'
) {
  process.exit(0);
}

const husky = (await import('husky')).default;
console.log(husky());
