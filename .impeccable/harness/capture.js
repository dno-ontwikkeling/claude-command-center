// Playwright snippet: captures the harness in both themes at 1440x900 into
// .impeccable/review/preview-{dark,light}.png. Fresh context each run so no
// module cache survives between edits.
async (page) => {
  const out = {};
  for (const theme of ['dark', 'light']) {
    const ctx = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 } });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
        // The dev server occasionally drops a connection on Windows; retry a cold load.
    let ready = false;
    for (let attempt = 0; attempt < 4 && !ready; attempt++) {
      await p.goto(`http://127.0.0.1:8765/.impeccable/harness/index.html?theme=${theme}`);
      ready = await p.waitForFunction(() => document.documentElement.dataset.harnessReady === '1', null, { timeout: 5000 }).then(() => true, () => false);
    }
    if (!ready) errs.push('not ready');
    await p.waitForTimeout(600);
    await p.screenshot({ path: `C:/Projects/Applications/claude-command-center/.impeccable/review/preview-${theme}.png` });
    out[theme] = errs;
    await ctx.close();
  }
  return out;
}
