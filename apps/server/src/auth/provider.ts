import { createHash } from "node:crypto";
export type DevUser = { id: string; displayName: string };
export interface AuthProvider {
  authenticate(request: Request): DevUser | null;
  users(): DevUser[];
}
/** Local development identity selection only: no fallback, cookie or bearer-token login. */
export class DevAuthProvider implements AuthProvider {
  private readonly configured: DevUser[];
  constructor(names: string[]) {
    this.configured = [...new Set(names)].map((name) => ({
      id: `dev-${createHash("sha256").update(name).digest("hex").slice(0, 24)}`,
      displayName: name,
    }));
  }
  users() {
    return this.configured.map((user) => ({ ...user }));
  }
  authenticate(request: Request) {
    const value = request.headers.get("X-AIDLC-User");
    return (
      this.configured.find(
        (user) => value === user.id || value === user.displayName,
      ) ?? null
    );
  }
}
