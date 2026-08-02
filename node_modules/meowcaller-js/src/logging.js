export function resolveConfig(opts) {
  const cfg = { logger: null, diag: null };
  for (const opt of opts) {
    if (typeof opt === 'function') opt(cfg);
  }
  return cfg;
}

export function WithLogger(logger) {
  return (cfg) => { cfg.logger = logger; };
}

export function WithDiagnostics(rec) {
  return (cfg) => { cfg.diag = rec; };
}
