import { expect, test } from "@playwright/test";
import { WECOM1, deleteIssueViaUi, loginAs, marker, appUrl } from "./utils";
import { sweepE2eData } from "./fixtures";

// 旅程 2（走查报告 §四-s2）：创建全链路 + 空值置灰承诺 + 看板渲染 + UI 删除清理
test.beforeEach(async () => {
  await sweepE2eData(); // 吸收上次中断的历史残渣（幂等）
});

test.afterEach(async () => {
  await sweepE2eData(); // 无论成败，失败路径的尝试数据一并兜走
});

test("创建 issue：空值置灰 → 提交 → 列表/看板可见 → 删除清理", async ({ page }) => {
  const title = marker("create");
  await loginAs(page, WECOM1);

  await page.goto(appUrl("/w/main/p/demo"));
  await expect(page.getByRole("link", { name: "演示项目" })).toBeVisible();

  await page.locator('button:has-text("创建问题")').click();
  await page.waitForURL("**/issues/new**", { timeout: 15_000 });

  // 空值置灰（客户端第一闸；服务端 zod 第二闸由 vitest/验收脚本背书）
  const createBtn = page.locator('button:has-text("创建"):not(:has-text("返回"))');
  await expect(createBtn).toBeDisabled();

  await page.locator('input[placeholder="问题标题"]').fill(title);
  await expect(createBtn).toBeEnabled();

  await page.locator('[contenteditable="true"]').first().click();
  await page.keyboard.type("从 e2e 创建：验证描述派生纯文本。");
  await page.locator('button:has-text("创建并返回")').click();

  await page.waitForURL("**/p/demo**", { timeout: 15_000 });
  const row = page.locator("tr", { hasText: title });
  await expect(row).toBeVisible();
  await expect(page.getByText(/问题已创建 #\d+/)).toBeVisible();

  // 看板渲染（列 + 卡片；拖拽不在 e2e 范围）
  await page.getByRole("tab", { name: "看板" }).click();
  await expect(page.locator('text="拖动卡片到这里"').first()).toBeVisible();
  // 看板卡片的锚：卡片内以 issue 标题为可访问名的链接（看板视图下唯一），
  // 防任意 div 含文本即过的通配断言静默漂移
  await expect(page.getByRole("link", { name: title })).toBeVisible();

  // 清理：走 UI 删除（含输入编号强校验的 ConfirmDialog），行随删即逝
  await page.getByRole("tab", { name: "列表" }).click();
  await row.locator("a").first().click();
  await page.waitForURL("**/issues/**", { timeout: 15_000 });
  const number = Number(page.url().match(/issues\/(\d+)/)?.[1]);
  await deleteIssueViaUi(page, number);
  await page.locator("tr").filter({ hasText: title }).waitFor({ state: "detached", timeout: 15_000 });
});
