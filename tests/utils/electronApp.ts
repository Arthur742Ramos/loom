import { ElectronApplication, Page, _electron as electron } from 'playwright';
import * as path from 'path';

export interface LoomAppContext {
  electronApp: ElectronApplication;
  page: Page;
}

export interface LaunchLoomOptions {
  env?: Record<string, string | undefined>;
}

export async function launchLoomApp(options: LaunchLoomOptions = {}): Promise<LoomAppContext> {
  const appPath = path.resolve(process.cwd(), 'dist/main/main.js');
  const electronApp = await electron.launch({
    args: [appPath],
    env: {
      ...process.env,
      LOOM_TEST_MODE: '1',
      LOOM_TEST_AGENT_RESPONSE: 'Mock response from Loom test mode',
      ...(options.env || {}),
    },
  });

  const page = await electronApp.firstWindow();
  await page.waitForSelector('[data-testid="sidebar"]');

  return { electronApp, page };
}

export async function setProjectInStore(page: Page, projectPath: string, projectName: string): Promise<void> {
  await page.waitForFunction(() => Boolean((window as any).__appStore));
  await page.evaluate(
    ([pathValue, nameValue]) => {
      const store = (window as any).__appStore;
      store.getState().setProject(pathValue, nameValue);
    },
    [projectPath, projectName] as [string, string],
  );
}

export async function stabilizePageForScreenshot(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
      }
      .typing-dot {
        animation: none !important;
      }
      input, textarea {
        caret-color: transparent !important;
      }
    `,
  });
}
