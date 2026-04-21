import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadDotEnv() {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;

  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^"|"$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

function createPassword() {
  return `${randomBytes(18).toString("base64url")}Aa1!`;
}

async function findUserByEmail(supabase, email) {
  let page = 1;
  const perPage = 1000;

  while (page <= 20) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage,
    });
    if (error) throw error;

    const user = data.users.find(
      (candidate) => candidate.email?.toLowerCase() === email.toLowerCase(),
    );
    if (user) return user;
    if (data.users.length < perPage) return null;
    page += 1;
  }

  return null;
}

loadDotEnv();

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const requestedAdminEmail = process.env.ADMIN_EMAIL || "admin@artficha.local";
const adminEmail = requestedAdminEmail.includes("@")
  ? requestedAdminEmail
  : `${requestedAdminEmail}@artficha.local`;
const adminPassword = process.env.ADMIN_PASSWORD || createPassword();

if (!supabaseUrl) {
  console.error("Falta SUPABASE_URL o VITE_SUPABASE_URL.");
  process.exit(1);
}

if (!serviceRoleKey) {
  console.error("Falta SUPABASE_SERVICE_ROLE_KEY.");
  console.error(
    "Ejemplo: $env:SUPABASE_SERVICE_ROLE_KEY='...'; $env:ADMIN_EMAIL='admin@artficha.com'; npm run admin:create",
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

let user = await findUserByEmail(supabase, adminEmail);

if (!user) {
  const { data, error } = await supabase.auth.admin.createUser({
    email: adminEmail,
    password: adminPassword,
    email_confirm: true,
    user_metadata: {
      role: "admin",
      source: "artficha-admin-bootstrap",
    },
  });

  if (error) throw error;
  user = data.user;
} else if (process.env.ADMIN_PASSWORD) {
  const { error } = await supabase.auth.admin.updateUserById(user.id, {
    password: adminPassword,
    user_metadata: {
      ...(user.user_metadata || {}),
      role: "admin",
      source: "artficha-admin-bootstrap",
    },
  });

  if (error) throw error;
}

const { error: roleError } = await supabase.from("user_roles").upsert(
  {
    user_id: user.id,
    role: "admin",
  },
  { onConflict: "user_id,role" },
);

if (roleError) throw roleError;

console.log("Cuenta admin lista.");
console.log(`Email: ${adminEmail}`);
if (!process.env.ADMIN_PASSWORD) {
  console.log(`Contrasena temporal: ${adminPassword}`);
  console.log("Guarda esta contrasena ahora; no se ha escrito en ningun archivo.");
} else {
  console.log("Contrasena: la indicada en ADMIN_PASSWORD.");
}
console.log(`User ID: ${user.id}`);
