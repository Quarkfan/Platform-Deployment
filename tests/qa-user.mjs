import { Pool } from "pg";
const { createAuth } = await import(
  process.env.CONSOLE_AUTH_MODULE ??
    new URL("../Platform-Console/dist-server/auth.js", import.meta.url).href
);

const username = process.env.QA_USERNAME ?? "";
const password = process.env.QA_PASSWORD ?? "";
const action = process.env.QA_ACTION ?? "create";
if (!/^codexqa[a-z0-9_]{6,40}$/.test(username))
  throw new Error("QA username must use the guarded codexqa prefix");
if (action === "create" && password.length < 20)
  throw new Error("QA password must contain at least 20 characters");

const databaseUrl = new URL(process.env.DATABASE_URL);
databaseUrl.searchParams.delete("options");
const pool = new Pool({
  connectionString: databaseUrl.toString(),
  options: "-c search_path=auth",
  max: 2,
});
try {
  await pool.query('DELETE FROM "user" WHERE username=$1', [username]);
  if (action === "create") {
    const auth = createAuth(pool, true);
    const result = await auth.api.signUpEmail({
      body: {
        username,
        displayUsername: username,
        email: `${username}@localhost.invalid`,
        password,
        name: "Codex UI QA",
      },
    });
    await pool.query('UPDATE "user" SET role=$1 WHERE id=$2', [
      "operator",
      result.user.id,
    ]);
  }
  console.log(JSON.stringify({ ok: true, action, username }));
} finally {
  await pool.end();
}
