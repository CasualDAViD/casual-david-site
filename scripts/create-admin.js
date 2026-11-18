'use strict';

// Creates the admin account, or promotes an existing account to admin.
//   npm run create-admin -- you@example.com
// The password is typed at a hidden prompt (or read from ADMIN_PASSWORD).

const path = require('node:path');
const readline = require('node:readline');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const { loadConfig } = require('../server/config');
const { openDb } = require('../server/db');
const { hashPassword } = require('../server/auth');
const { cleanEmail, passwordProblem } = require('../server/validate');

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function main() {
  const email = cleanEmail(process.argv[2] || await ask('Admin email: '));
  if (!email) throw new Error('That is not a valid email address.');

  const config = loadConfig();
  const db = openDb(config.dataDir);
  const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

  let password = process.env.ADMIN_PASSWORD;
  if (!password) {
    const prompt = existing ? 'New password (leave empty to keep the current one): ' : 'Password (8+ characters): ';
    password = await ask(prompt, { hidden: true });
  }

  if (existing) {
    if (password) {
      const problem = passwordProblem(password);
      if (problem) throw new Error(problem);
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(password), existing.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(existing.id);
    }
    db.prepare("UPDATE users SET role = 'admin', email_verified = 1 WHERE id = ?").run(existing.id);
    console.log(`${email} is now an admin.`);
  } else {
    const problem = passwordProblem(password);
    if (problem) throw new Error(problem);
    const name = process.env.ADMIN_NAME || email.split('@')[0];
    db.prepare("INSERT INTO users (email, name, password_hash, role, email_verified) VALUES (?, ?, ?, 'admin', 1)")
      .run(email, name, await hashPassword(password));
    console.log(`Admin account created for ${email}.`);
  }
  db.close();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
