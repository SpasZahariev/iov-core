// this should return true to skip ledger tests (to run on CI)
//
// current solution: check for LEDGER_ENABLED=true environmental variable
// Does this work in browsers??

export const skipTests = (): boolean => !process.env.LEDGER_ENABLED && !process.env.LEDGER_ALL;
export const pendingWithoutLedger = (): void => {
  if (skipTests()) {
    pending("Set LEDGER_ENABLED to run ledger tests");
  }
};

export const skipSeededTests = (): boolean => !process.env.LEDGER_SEEDED && !process.env.LEDGER_ALL;
export const pendingWithoutSeededLedger = (): void => {
  if (skipSeededTests()) {
    pending("Set LEDGER_SEEDED to enable derivation tests, ledger must be seeded with test key");
  }
};

export const skipInteractiveTests = (): boolean => !process.env.LEDGER_INTERACTIVE && !process.env.LEDGER_ALL;
export const pendingWithoutInteractiveLedger = (): void => {
  if (skipInteractiveTests()) {
    pending("Set LEDGER_INTERACTIVE to run ledger tests");
  }
};
