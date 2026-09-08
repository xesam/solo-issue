import SignInForm from "@/components/auth/SignInForm";

// U1.1：SignInForm 不再使用 useSearchParams（避免整页 bail out 到客户端渲染），
// 此处无需 Suspense——表单外壳随 SSR HTML 直出，JS 失败也能看到登录表单。
export default function SignInPage() {
  return <SignInForm />;
}
