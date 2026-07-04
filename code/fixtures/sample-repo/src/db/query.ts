import { db } from './client';

export async function searchUsers(term: string) {
  // Vulnerable: user input interpolated into query
  const result = await db.query('SELECT * FROM users WHERE name = $1', [term]);
  return result.rows;
}

export async function searchUsersSafe(term: string) {
  return db.query('SELECT * FROM users WHERE name = $1', [term]);
}
