import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/api";
import { MAX_UPLOAD_BYTES, deleteFile, getFile, putFile, resolveKey } from "@/server/storage";
import {
  createAttachment,
  listAttachments,
  readAttachment,
  removeAttachment,
} from "@/server/services/attachment";
import {
  addMember,
  cleanupFixtures,
  mkProject,
  mkUser,
  mkWorkspace,
} from "./helpers";

// 附件存储（UPLOAD_DIR 已在 setup.ts 重定向到临时沙箱） + 权限矩阵

let owner!: Awaited<ReturnType<typeof mkUser>>;
let member!: Awaited<ReturnType<typeof mkUser>>;
let guest!: Awaited<ReturnType<typeof mkUser>>;
let outsider!: Awaited<ReturnType<typeof mkUser>>;
let ws!: Awaited<ReturnType<typeof mkWorkspace>>;
let project!: Awaited<ReturnType<typeof mkProject>>;
let issueNumber!: number;
const actor = () => ({ id: owner.id, name: owner.name });

const expectHttpError = async (p: Promise<unknown>, status: number) => {
  try {
    await p;
    expect.unreachable(`应当 ${status}`);
  } catch (e) {
    expect((e as { status?: number }).status).toBe(status);
  }
};

beforeAll(async () => {
  owner = await mkUser({ name: "上传者" });
  member = await mkUser({ name: "读件人" });
  guest = await mkUser({ name: "访客" });
  outsider = await mkUser({ name: "路人" });
  ws = await mkWorkspace(owner.id);
  await addMember(ws.id, member.id, "MEMBER");
  await addMember(ws.id, guest.id, "GUEST");
  project = await mkProject(ws.id, owner.id);
  const { createIssue } = await import("@/server/services/issue");
  const issue = await createIssue(project.id, { title: "附件宿主" }, actor());
  issueNumber = issue.number;
});

const orphanIds: string[] = []; // 无 FK 的附件孤儿行登记簿（级联清不到，afterAll 显式删）

afterAll(async () => {
  // storage 沙箱是临时目录（每次运行独立 mkdtemp），OS 自清；此处只清 DB fixtures
  if (orphanIds.length) {
    await prisma.attachment.deleteMany({ where: { id: { in: orphanIds } } }).catch(() => {});
  }
  await cleanupFixtures();
});

describe("resolveKey（穿越防护靠随机前缀，不靠字符清洗）", () => {
  it("保留合法字符（含中文/点），随机段缀于开头", () => {
    const key = resolveKey("issue-123", "报告 final$$$.pdf");
    expect(key.startsWith("issue-123/")).toBe(true);
    expect(key.endsWith(".pdf")).toBe(true);
    expect(key).not.toContain("$");
  });
  it("超长文件名截尾", () => {
    const key = resolveKey("i", `${"长".repeat(200)}.png`);
    // 紧上界：uuid 36 + '-' 1 + 文件名 ≤100 = 137（留余量会放过截尾超长退化）
    expect(key.split("/")[1]!.length).toBeLessThanOrEqual(137);
  });
});

describe("storage 原语（沙箱内）", () => {
  it("put/get 往返一致；delete 幂等", async () => {
    const key = resolveKey("i-tests", "a.bin");
    const payload = Buffer.from([0x00, 0x01, 0xfe, 0xff]);
    await putFile(key, payload);
    expect((await getFile(key)).equals(payload)).toBe(true);
    await deleteFile(key);
    await deleteFile(key); // 幂等：不存在的文件不炸
    await expect(getFile(key)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("越界键（路径穿越）在 absPath 层即刻拒绝", async () => {
    await expect(putFile("../../etc/passwd-pwn", Buffer.alloc(1))).rejects.toThrow(
      /非法存储键/,
    );
    await expect(getFile("../escape")).rejects.toThrow(/非法存储键/);
    // deleteFile 同样把同步抛错透传出去（.catch 只挂在 unlink 的 promise 上）
    await expect(deleteFile("../escape")).rejects.toThrow(/非法存储键/);
  });
});

describe("attachment 服务", () => {
  let attId!: string;

  it("上传落行 + 落盘：size/mimeType 兜底", async () => {
    const created = await createAttachment({
      projectId: project.id,
      number: issueNumber,
      uploaderId: owner.id,
      filename: "截图.png",
      mimeType: "",
      buffer: Buffer.from("png-bytes"),
    });
    attId = created.id;
    expect(created.size).toBe(9);
    expect(created.mimeType).toBe("application/octet-stream"); // 空串兜底
    const { att, buffer } = await readAttachment(attId, member.id);
    expect(buffer.toString()).toBe("png-bytes");
    expect(att.id).toBe(attId);
    expect(att.filename).toBe("截图.png");
  });

  it("列表按时间倒序；未知 issue 404；越限 413", async () => {
    // 真倒序锚：再上传一个更新的附件，列表首行必须是它（orderBy 退化/乱序会红）
    await new Promise((r) => setTimeout(r, 3)); // 隔开 createdAt 毫秒
    const second = await createAttachment({
      projectId: project.id,
      number: issueNumber,
      uploaderId: owner.id,
      filename: "第二批.png",
      mimeType: "image/png",
      buffer: Buffer.from("later"),
    });
    orphanIds.push(second.id); // 无 FK 级联，纪律：所有行进登记簿
    const list = await listAttachments(project.id, issueNumber);
    expect(list.map((a) => a.id)).toContain(attId);
    expect(list[0]!.id).toBe(second.id); // createdAt desc：新者在前
    await expectHttpError(listAttachments(project.id, 999999), 404);
    await expectHttpError(
      createAttachment({
        projectId: project.id,
        number: 999999,
        uploaderId: owner.id,
        filename: "x",
        mimeType: "text/plain",
        buffer: Buffer.alloc(1),
      }),
      404,
    );
    await expectHttpError(
      createAttachment({
        projectId: project.id,
        number: issueNumber,
        uploaderId: owner.id,
        filename: "大文件.bin",
        mimeType: "application/octet-stream",
        buffer: Buffer.alloc(MAX_UPLOAD_BYTES + 1),
      }),
      413,
    );
  });

  it("读取鉴权：非成员 404；访客只读可读但删除 403；成员可删且文件随删", async () => {
    await expectHttpError(readAttachment(attId, outsider.id), 404); // 404 防枚举
    const byGuest = await readAttachment(attId, guest.id);
    expect(byGuest).toBeTruthy(); // 读对访客开放
    await expectHttpError(removeAttachment(attId, guest.id), 403);

    // 删除动作者用普通成员（ws MEMBER 无项目角色）：canWriteWithRoles 的成员分支
    const { att } = await readAttachment(attId, owner.id);
    await removeAttachment(attId, member.id);
    await expect(getFile(att.storageKey)).rejects.toMatchObject({ code: "ENOENT" }); // 磁盘文件同删
    await expectHttpError(readAttachment(attId, member.id), 404);
  });

  it("评论附件归属路径（commentId → issue → project 权限）走查：无宿主附件即 404", async () => {
    const orphan = await prisma.attachment.create({
      data: {
        issueId: null,
        commentId: null,
        uploaderId: owner.id,
        storageKey: resolveKey("orphan", "o.bin"),
        filename: "o",
        size: 1,
        mimeType: "text/plain",
      },
    });
    orphanIds.push(orphan.id); // attachments 无 FK 级联，须显式清（纪律：所有行进登记簿）
    await expectHttpError(readAttachment(orphan.id, owner.id), 404); // 无归属 = 不可见
  });
});
