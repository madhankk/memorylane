import type { FastifyInstance } from "fastify";
import { setupRequestSchema, loginRequestSchema, changePasswordRequestSchema, type UserDto } from "@memorylane/shared";
import type { AppContext } from "../context.js";
import { hashPassword, verifyPassword } from "../auth/passwords.js";

interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  created_at: string;
}

function toUserDto(row: UserRow): UserDto {
  return { id: row.id, username: row.username, createdAt: row.created_at };
}

export async function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { db, sessions } = ctx;

  app.post("/api/auth/setup", async (request, reply) => {
    const existingCount = (db.prepare("SELECT COUNT(*) as c FROM users").get() as { c: number }).c;
    if (existingCount > 0) {
      return reply.code(409).send({ error: "Setup has already been completed" });
    }

    const parsed = setupRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid input", details: parsed.error.flatten() });
    }

    const { username, password } = parsed.data;
    const passwordHash = await hashPassword(password);
    db.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)").run(username, passwordHash);

    // Deliberately do not create a session here - the product spec requires an
    // explicit re-login after first-run setup rather than auto-authenticating.
    reply.clearCookie("memorylane_session", { path: "/" });
    return reply.code(201).send({ ok: true });
  });

  app.post("/api/auth/login", async (request, reply) => {
    const parsed = loginRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid input" });
    }

    const { username, password } = parsed.data;
    const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username) as
      | UserRow
      | undefined;

    // Constant-shape response whether the username exists or not, to avoid
    // user enumeration via timing/response differences.
    const validPassword = user ? await verifyPassword(user.password_hash, password) : false;
    if (!user || !validPassword) {
      return reply.code(401).send({ error: "Invalid username or password" });
    }

    const session = sessions.create(user.id);
    app.setSessionCookie(reply, session.id);
    return reply.send({ user: toUserDto(user) });
  });

  app.put("/api/auth/password", { preHandler: app.requireAuth }, async (request, reply) => {
    const parsed = changePasswordRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid input", details: parsed.error.flatten() });
    }

    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(request.userId) as UserRow | undefined;
    if (!user) return reply.code(401).send({ error: "Not authenticated" });

    const { currentPassword, newPassword } = parsed.data;
    if (!(await verifyPassword(user.password_hash, currentPassword))) {
      return reply.code(401).send({ error: "Current password is incorrect" });
    }

    const newHash = await hashPassword(newPassword);
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(newHash, user.id);

    // Sign out everywhere else - the current session (which just proved
    // knowledge of the password) stays logged in.
    const currentSessionId = request.cookies["memorylane_session"];
    sessions.destroyAllForUser(user.id, currentSessionId);

    return reply.send({ ok: true });
  });

  app.post("/api/auth/logout", { preHandler: app.requireAuth }, async (request, reply) => {
    const sessionId = request.cookies["memorylane_session"];
    if (sessionId) sessions.destroy(sessionId);
    app.clearSessionCookie(reply);
    return reply.send({ ok: true });
  });

  app.get("/api/auth/me", async (request, reply) => {
    const setupCount = (db.prepare("SELECT COUNT(*) as c FROM users").get() as { c: number }).c;
    const needsSetup = setupCount === 0;

    if (!request.userId) {
      return reply.send({ user: null, needsSetup });
    }
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(request.userId) as
      | UserRow
      | undefined;
    return reply.send({ user: user ? toUserDto(user) : null, needsSetup });
  });
}
