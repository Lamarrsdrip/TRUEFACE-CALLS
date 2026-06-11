import { AuthFrame, SignupForm } from "../../components/auth-form";

export default function SignupPage() {
  return (
    <AuthFrame
      title="Create your account"
      description="Start with trial credits and one consent-verified face profile."
    >
      <SignupForm />
    </AuthFrame>
  );
}
