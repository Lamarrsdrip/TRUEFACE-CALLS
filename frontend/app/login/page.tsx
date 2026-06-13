import { AuthFrame, LoginForm } from "../../components/auth-form";

export default function LoginPage() {
  return (
    <AuthFrame
      title="Welcome back"
      description="Sign in to manage calls, faces, and credits."
    >
      <LoginForm />
    </AuthFrame>
  );
}
