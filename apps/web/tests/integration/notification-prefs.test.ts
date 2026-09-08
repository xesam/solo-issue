import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { NOTIFICATION_TYPES, resolvePrefs } from "@/server/services/notification";
import { cleanupFixtures, mkProject, mkUser, mkWorkspace } from "./helpers";

// 通知偏好解析：全局行 → 项目行覆盖（同键逐项覆盖），缺省全开

let user!: Awaited<ReturnType<typeof mkUser>>;
let project!: Awaited<ReturnType<typeof mkProject>>;
let ws!: Awaited<ReturnType<typeof mkWorkspace>>;

beforeAll(async () => {
  user = await mkUser({ name: "偏好主人" });
  ws = await mkWorkspace(user.id);
  project = await mkProject(ws.id, user.id);
});

afterAll(cleanupFixtures);

describe("resolvePrefs（偏好合并语义）", () => {
  it("无任何偏好行：四种类型全开（缺省推送通道全 true）", async () => {
    const prefs = await resolvePrefs(user.id, project.id);
    expect(Object.keys(prefs).sort()).toEqual([...NOTIFICATION_TYPES].sort());
    for (const v of Object.values(prefs)) expect(v.wecom).toBe(true);
  });

  it("全局行关闭 ASSIGNED；项目行再局部开回", async () => {
    await prisma.notificationPreference.create({
      data: {
        userId: user.id,
        projectId: null,
        prefs: { ASSIGNED: { wecom: false } },
      },
    });
    const globalApplied = await resolvePrefs(user.id, project.id);
    expect(globalApplied.ASSIGNED.wecom).toBe(false);
    expect(globalApplied.COMMENTED.wecom).toBe(true); // 其他类型不受影响

    await prisma.notificationPreference.create({
      data: {
        userId: user.id,
        projectId: project.id,
        prefs: { ASSIGNED: { wecom: true } }, // 项目行覆盖全局
      },
    });
    const projectApplied = await resolvePrefs(user.id, project.id);
    expect(projectApplied.ASSIGNED.wecom).toBe(true);

    // 项目行只影响该项目：另一个项目回落全局行
    const other = await mkProject(ws.id, user.id);
    const otherPrefs = await resolvePrefs(user.id, other.id);
    expect(otherPrefs.ASSIGNED.wecom).toBe(false);
  });

  it("projectId=null 只读全局行", async () => {
    const prefs = await resolvePrefs(user.id, null);
    expect(prefs.ASSIGNED.wecom).toBe(false); // 全局行生效
  });
});
