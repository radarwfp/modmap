import { db } from '../database/db.client'
import type { User } from '../database/db.client'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AuthToken {
  token: string
  userId: string
  expiresAt: Date
}

export interface LoginResult {
  success: boolean
  token?: AuthToken
  error?: string
}

// ── In-memory token store ─────────────────────────────────────────────────────

const activeTokens: Map<string, AuthToken> = new Map()

function generateToken(): string {
  return 'tok_' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

// ── Auth service ──────────────────────────────────────────────────────────────

export function login(email: string, _password: string): LoginResult {
  const user = db.users.findByEmail(email)
  if (!user) {
    return { success: false, error: 'User not found' }
  }

  // In a real app: bcrypt.compare(_password, user.passwordHash)
  const token: AuthToken = {
    token: generateToken(),
    userId: user.id,
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 8), // 8 hours
  }

  activeTokens.set(token.token, token)
  return { success: true, token }
}

export function logout(token: string): void {
  activeTokens.delete(token)
}

export function validateToken(token: string): AuthToken | null {
  const record = activeTokens.get(token)
  if (!record) return null
  if (record.expiresAt < new Date()) {
    activeTokens.delete(token)
    return null
  }
  return record
}

export function getCurrentUser(token: string): User | null {
  const record = validateToken(token)
  if (!record) return null
  return db.users.findById(record.userId)
}

export function getUserById(userId: string): User | null {
  return db.users.findById(userId)
}

export function requireAuth(token: string): User {
  const user = getCurrentUser(token)
  if (!user) throw new Error('Unauthorized: invalid or expired token')
  return user
}

export function requireRole(token: string, role: User['role']): User {
  const user = requireAuth(token)
  const hierarchy: Record<User['role'], number> = { admin: 3, member: 2, viewer: 1 }
  if (hierarchy[user.role] < hierarchy[role]) {
    throw new Error(`Forbidden: requires ${role} role, got ${user.role}`)
  }
  return user
}
