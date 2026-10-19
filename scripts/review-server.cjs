// Review launcher: timestamp logs without changing normal server startup.
for (const level of ['log', 'warn', 'error', 'info']) {
  const original = console[level].bind(console);
  console[level] = (...args) => original(new Date().toISOString(), ...args);
}
process.env.FIELDMAPPER_REVIEW_LOGS = '1';
require('../server');
