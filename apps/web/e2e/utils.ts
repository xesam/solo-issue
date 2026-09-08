import { expect, type Page } from "@playwright/test";
import { BASE_PATH } from "../src/lib/base-path";

// E2E 公共设施：mock 通道登录 / 唯一标记 / UI 删除清理。
// 数据纪律与 tests/integration 同源：只碰自己建的行、用完即删，不读写种子数据
// （demo 项目/种子用户仅作为容器与登录身份复用）。

/** 站内路径拼接：basePath 单源 src/lib/base-path.ts——goto 直写 "/w/..." 绝对路径
 *  会被 URL 解析洗掉部署前缀段（默认 /solo-issue），一律经本函数进页面 */
export function appUrl(path: string) {
  return `${BASE_PATH}${path}`;
}

export const WECOM1 = "企业微信1";
export const WECOM2 = "企业微信2";

/** 每条 spec 自己的走查数据唯一前缀（列表可见性断言互不串台） */
export function marker(spec: string) {
  return `E2E-${spec}-${Date.now().toString(36)}`;
}

/** 企微 mock 通道登录（开发态默认启用；pnpm verify 由 ALLOW_IM_MOCK 保证）→ 落地 /me */
export async function loginAs(page: Page, userName: string) {
  await page.goto(appUrl("/signin"));
  await page.locator('a[href*="/api/auth/wecom/web-start"]').first().click();
  // exact 必须开：string name 是子串匹配，"企业微信1" 会连 "企业微信100" 一起命中
  const candidate = page.getByRole("button", { name: userName, exact: true });
  await candidate.waitFor({ state: "visible", timeout: 15_000 });
  await candidate.click();
  await page.waitForURL("**/me**", { timeout: 15_000 });
  await expect(page.getByRole("link", { name: /个人工作台/ })).toBeVisible();
}

/** 顶栏账号菜单 → 退出登录 → 回到 /signin */
export async function logout(page: Page) {
  await page.locator('button[aria-label*="账号菜单"]').click();
  await page.getByRole("menuitem", { name: "退出登录" }).click();
  await page.waitForURL("**/signin**", { timeout: 15_000 });
}

/** 详情页 UI 删除（输入编号强校验的 ConfirmDialog 一并走真实路径） */
export async function deleteIssueViaUi(page: Page, number: number) {
  await page.locator('button:has-text("删除")').first().click();
  const dialog = page.locator('[role="dialog"]').last();
  await dialog.locator('input[aria-label*="确认"]').fill(String(number));
  await dialog.getByRole("button", { name: "永久删除" }).click();
  await page.waitForURL("**/p/demo**", { timeout: 15_000 });
}
