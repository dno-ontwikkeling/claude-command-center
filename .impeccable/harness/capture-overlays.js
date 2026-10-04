// Playwright snippet: opens each overlay/menu in the harness and captures it
// into .impeccable/review/ov-<theme>-<name>.png.
async (page) => {
  const out = {};
  const dir = 'C:/Projects/Applications/claude-command-center/.impeccable/review/';
  for (const theme of ['dark', 'light']) {
    const ctx = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 } });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    const open = async () => {
      // The dev server occasionally drops a connection on Windows; retry a cold load.
      for (let attempt = 0; attempt < 4; attempt++) {
        await p.goto(`http://127.0.0.1:8765/.impeccable/harness/index.html?theme=${theme}`);
        const ok = await p.waitForFunction(() => document.documentElement.dataset.harnessReady === '1', null, { timeout: 5000 }).then(() => true, () => false);
        if (ok) return;
      }
      throw new Error('harness not ready');
    };
    const shot = (name) => p.screenshot({ path: `${dir}ov-${theme}-${name}.png` });

    const step = async (name, fn) => {
      try {
        await fn();
      } catch (e) {
        errs.push(`${name}: ${e.message.slice(0, 160)}`);
      }
    };
    await step('settings', async () => {
    await open();
    await p.click('#settings-btn');
    await p.waitForTimeout(200);
    await shot('settings');
    await p.click('.set-tab[data-tab="remote"]');
    await p.waitForTimeout(200);
    await shot('settings-remote');
    });
    await step('menu', async () => {
    await open();
    await p.hover('.agent[data-id="h0"]');
    await p.click('.agent[data-id="h0"] .kebab');
    await p.waitForTimeout(150);
    await shot('menu');
    });
    await step('worktree', async () => {
    await open();
    await p.hover('.project');
    await p.click('.project .add-agent');
    await p.waitForTimeout(300);
    await shot('worktree');
    });
    await step('prompts', async () => {
    await open();
    await p.click('#prompts-btn');
    await p.waitForTimeout(150);
    await shot('prompts-menu');
    await p.click('#kebab-menu button:last-child');
    await p.waitForTimeout(200);
    await shot('prompts-manager');
    });
    await step('confirm', async () => {
    await open();
    await p.hover('.agent[data-id="h0"]');
    await p.click('.agent[data-id="h0"] .kebab');
    await p.click('#kebab-menu button.danger');
    await p.waitForTimeout(200);
    await shot('confirm');
    });

    await step('hover', async () => {
    await open();
    await p.hover('.project');
    await p.waitForTimeout(100);
    await shot('hover-project');
    await p.hover('.section-head');
    await p.waitForTimeout(100);
    await shot('hover-section');
    });

    // The app opens at 1100x720 (main.js); the narrow end of the window.
    await step('narrow', async () => {
    await p.setViewportSize({ width: 1100, height: 720 });
    await open();
    await p.waitForTimeout(400);
    await p.screenshot({ path: `${dir}narrow-${theme}.png` });
    await p.setViewportSize({ width: 1440, height: 900 });
    });

    out[theme] = errs;
    await ctx.close();
  }
  return out;
}
