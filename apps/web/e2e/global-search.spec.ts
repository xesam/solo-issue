import { expect, test } from "@playwright/test";
import { WECOM1, deleteIssueViaUi, loginAs, marker, appUrl } from "./utils";
import { sweepE2eData } from "./fixtures";

// 旅程 7（走查报告 §四-s6）：全局搜索两条打开路径（回车 / 点击）都落到深链
test.beforeEach(async () => {
  await sweepE2eData(); // 吸收上次中断的历史残渣（幂等）
});

test.afterEach(async () => {
  await sweepE2eData(); // 无论成败，失败路径的尝试数据一并兜走
});

test("全局搜索：⌘K 检索 → 回车与点击双路径深链", async ({ page }) => {
  const title = marker("search");
  await loginAs(page, WECOM1);

  // 前置：造一条可检索数据
  await page.goto(appUrl("/w/main/p/demo/issues/new"));
  await page.locator('input[placeholder="问题标题"]').fill(title);
  await page.locator('button:has-text("创建并返回")').click();
  await page.waitForURL("**/p/demo**", { timeout: 15_000 });
  const row = page.locator("tr", { hasText: title });
  await row.locator("a").first().click();
  await page.waitForURL("**/issues/**", { timeout: 15_000 });
  const number = Number(page.url().match(/issues\/(\d+)/)?.[1]);
  const issueUrl = page.url();

  // 路径一：⌘K 面板 → 回车打开
  await page.keyboard.press("ControlOrMeta+k");
  const input = page.locator('input[placeholder*="搜索"]');
  await expect(input).toBeVisible();
  await input.fill(title);
  await expect(page.getByRole("option", { name: new RegExp(title) })).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press("Enter");
  await page.waitForURL("**/issues/**", { timeout: 15_000 });
  expect(page.url()).toBe(issueUrl);

  // 路径二：鼠标点击结果（走 role=option 内层按钮，全局搜索与提及弹层同构语义）
  await page.goto(appUrl("/me"));
  await page.keyboard.press("ControlOrMeta+k");
  await page.locator('input[placeholder*="搜索"]').fill(title);
  await page
    .getByRole("option", { name: new RegExp(title) })
    .locator("button")
    .click();
  await page.waitForURL("**/issues/**", { timeout: 15_000 });
  expect(page.url()).toBe(issueUrl);

  await deleteIssueViaUi(page, number);
});
