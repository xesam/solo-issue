// API Token 的 scope 白名单（无运行时依赖，可被客户端表单与服务端共用）
// token.ts 与 validations.ts 都从这里取，避免两处硬编码漂移。

export const API_SCOPES = [
  "*",
  "issues:read",
  "issues:write",
  "comments:read",
  "comments:write",
  "search:read",
  "activities:read",
  "projects:read",
  "fields:read",
  "fields:write",
] as const;
