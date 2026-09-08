import { expect, test } from "@playwright/test";
import { WECOM1, deleteIssueViaUi, loginAs, marker, appUrl } from "./utils";
import { sweepE2eData } from "./fixtures";

// 旅程 3（走查报告 §四-s3）：状态机两段流转 + 时间线审计可见
test.beforeEach(async () => {
  await sweepE2eData(); // 吸收上次中断的历史残渣（幂等）
});

test.afterEach(async () => {
  await sweepE2eData(); // 无论成败，失败路径的尝试数据一并兜走
});

test("状态流转：待处理池 → 进行中 → 已完成，时间线逐条落痕", async ({ page }) => {
  const title = marker("state");
  await loginAs(page, WECOM1);

  await page.goto(appUrl("/w/main/p/demo/issues/new"));
  await page.locator('input[placeholder="问题标题"]').fill(title);
  await page.locator('button:has-text("创建并返回")').click();
  await page.waitForURL("**/p/demo**", { timeout: 15_000 });

  const row = page.locator("tr", { hasText: title });
  await row.locator("a").first().click();
  await page.waitForURL("**/issues/**", { timeout: 15_000 });
  const number = Number(page.url().match(/issues\/(\d+)/)?.[1]);

  const save = page.locator('button:has-text("保存"):not(:has-text("返回"))');

  // 第一段：待处理池 → 进行中
  await page.getByText("待处理池", { exact: true }).first().click();
  await page.getByRole("option", { name: "进行中", includeHidden: false }).click();
  await save.click();
  await expect(page.getByText("已保存").first()).toBeVisible();
  await expect(page.getByText("将状态从 待处理池 改为 进行中")).toBeVisible();

  // 第二段：进行中 → 已完成
  await page.getByText("进行中", { exact: true }).first().click();
  await page.getByRole("option", { name: "已完成", includeHidden: false }).click();
  await save.click();
  await expect(page.getByText("将状态从 进行中 改为 已完成")).toBeVisible();

  // 状态触发器回显终态
  await expect(page.getByText("已完成", { exact: true }).first()).toBeVisible();

  await deleteIssueViaUi(page, number);
});
