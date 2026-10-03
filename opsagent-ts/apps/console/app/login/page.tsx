import { login } from "../actions";
import { Card } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <div className="login">
      <Card>
        <div className="brand">
          <span className="brand-mark">O</span>OpsAgent
        </div>
        <h1>Welcome to your workspace</h1>
        <p className="muted">Sign in to manage your AI operations team.</p>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <form action={login}>
          <label>
            Username
            <input name="username" autoComplete="username" required />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          <Button>Sign in</Button>
          <small>Sandbox login: demo / demo</small>
        </form>
      </Card>
    </div>
  );
}
