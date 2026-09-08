// 统一错误转译：REST 状态码 → MCP tool result（isError + 人话指引）。
// 指引语义与根目录 AGENTS.md §3「错误与重试」逐条一致，断言以状态码为准

export class ApiHttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public retryAfter?: string,
  ) {
    super(message);
  }
}

const GUIDANCE: Record<number, string> = {
  401: "令牌无效/过期/已撤销——停止操作，提醒人类在部署实例重新签发",
  403: "scope 或角色不足，或该端点不向 API 令牌开放——不要重试；核对令牌 scope 与所属用户角色",
  404: "对象不存在或无权可见——按不存在处理",
  422: "参数校验失败——按字段明细修正参数后重试",
  426: "本 MCP 包版本低于服务端下限——升级后重试：npx -y solo-issue-mcp@latest",
  429: "触发令牌频控——等待指示的秒数后再调用，批量操作请放慢节奏",
};

type ToolTextResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

export function okResult(data: unknown): ToolTextResult {
  return { content: [{ type: "text", text: JSON.stringify(data ?? null) }] };
}

export function errorResult(e: unknown): ToolTextResult {
  if (e instanceof ApiHttpError) {
    const tip =
      GUIDANCE[e.status] ??
      (e.status >= 500
        ? "服务端错误——读操作可指数退避重试（≤3 次）；写操作请先用 search/读工具确认未产生变更再决定重试"
        : "请求失败");
    const ra = e.retryAfter ? `（Retry-After: ${e.retryAfter}s）` : "";
    return {
      content: [{ type: "text", text: `[HTTP ${e.status}] ${e.message}${ra} —— ${tip}` }],
      isError: true,
    };
  }
  return {
    content: [{ type: "text", text: `[MCP] ${e instanceof Error ? e.message : String(e)}` }],
    isError: true,
  };
}
