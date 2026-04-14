# Context: modmap session
Task: add priority field to tasks
Active modules: tasks


## project-map.json
```json
{
  "project": "modmap-demo",
  "version": "1.0.0",
  "description": "Task manager API — demo project for the modmap protocol",
  "modules": ["database", "auth", "notifications", "tasks", "api"],

  "graph": {
    "database":      { "dependsOn": [] },
    "auth":          { "dependsOn": ["database"] },
    "notifications": { "dependsOn": ["database"] },
    "tasks":         { "dependsOn": ["database", "auth", "notifications"] },
    "api":           { "dependsOn": ["auth", "tasks", "notifications"] }
  },

  "entrypoints": {
    "http": "api/api.handlers.ts — route(req)"
  },

  "conventions": {
    "auth":         "All service functions that modify data take token as first arg. Use requireAuth() or requireRole().",
    "errors":       "Throw plain Error with descriptive messages. Handlers convert to HTTP status codes.",
    "ids":          "All IDs are prefixed strings: u1/u2 (users), task_xxx (tasks), notif_xxx (notifications), p1 (projects).",
    "notifications":"Always use sendAlert() from notifications module — never write to db.notifications directly.",
    "db":           "Never import db.client outside of service files. API handlers must go through service functions."
  },

  "lastModified": "2026-04-14"
}

```

## tasks/ (full code)
```typescript
// ── tasks.service.ts ──
import { db } from '../database/db.client'
import type { Task, TaskStatus, TaskPriority } from '../database/db.client'
import { requireAuth, requireRole, getUserById } from '../auth/auth.service'
import { sendAlert } from '../notifications/notifications.service'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CreateTaskInput {
  title: string
  description?: string
  priority?: TaskPriority
  assigneeId?: string
  projectId: string
  dueDate?: Date
}

export interface UpdateTaskInput {
  title?: string
  description?: string
  priority?: TaskPriority
  status?: TaskStatus
  assigneeId?: string
  dueDate?: Date
}

export interface TaskWithAssignee extends Task {
  assignee?: { id: string; name: string; email: string }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateId(): string {
  return 'task_' + Math.random().toString(36).slice(2)
}

function enrichTask(task: Task): TaskWithAssignee {
  if (!task.assigneeId) return task
  const user = getUserById(task.assigneeId)
  return {
    ...task,
    assignee: user ? { id: user.id, name: user.name, email: user.email } : undefined,
  }
}

// ── Tasks service ─────────────────────────────────────────────────────────────

export function createTask(token: string, input: CreateTaskInput): TaskWithAssignee {
  const creator = requireAuth(token)

  const task: Task = {
    id: generateId(),
    title: input.title,
    description: input.description,
    status: 'todo',
    priority: input.priority ?? 'medium',
    assigneeId: input.assigneeId,
    creatorId: creator.id,
    projectId: input.projectId,
    dueDate: input.dueDate,
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  db.tasks.save(task)

  if (input.assigneeId && input.assigneeId !== creator.id) {
    sendAlert({
      userId: input.assigneeId,
      message: `You've been assigned a new task: "${task.title}"`,
      channel: 'in_app',
    })
  }

  return enrichTask(task)
}

export function updateTask(token: string, taskId: string, input: UpdateTaskInput): TaskWithAssignee {
  requireAuth(token)

  const task = db.tasks.findById(taskId)
  if (!task) throw new Error(`Task not found: ${taskId}`)

  const previousAssignee = task.assigneeId
  const updated: Task = { ...task, ...input, updatedAt: new Date() }
  db.tasks.save(updated)

  // Notify new assignee if changed
  if (input.assigneeId && input.assigneeId !== previousAssignee) {
    sendAlert({
      userId: input.assigneeId,
      message: `You've been assigned task: "${updated.title}"`,
      channel: 'in_app',
    })
  }

  // Notify assignee when status changes to done
  if (input.status === 'done' && updated.assigneeId) {
    sendAlert({
      userId: updated.assigneeId,
      message: `Task completed: "${updated.title}"`,
      channel: 'in_app',
    })
  }

  return enrichTask(updated)
}

export function assignTask(token: string, taskId: string, assigneeId: string): TaskWithAssignee {
  return updateTask(token, taskId, { assigneeId })
}

export function completeTask(token: string, taskId: string): TaskWithAssignee {
  return updateTask(token, taskId, { status: 'done' })
}

export function deleteTask(token: string, taskId: string): void {
  requireRole(token, 'admin')
  const task = db.tasks.findById(taskId)
  if (!task) throw new Error(`Task not found: ${taskId}`)
  db.tasks.delete(taskId)
}

export function getTask(token: string, taskId: string): TaskWithAssignee {
  requireAuth(token)
  const task = db.tasks.findById(taskId)
  if (!task) throw new Error(`Task not found: ${taskId}`)
  return enrichTask(task)
}

export function getProjectTasks(token: string, projectId: string): TaskWithAssignee[] {
  requireAuth(token)
  return db.tasks.findByProject(projectId).map(enrichTask)
}

export function getMyTasks(token: string): TaskWithAssignee[] {
  const user = requireAuth(token)
  return db.tasks.findByAssignee(user.id).map(enrichTask)
}

```

## database/ (full code)
```typescript
// ── db.client.ts ──
// ── Core domain types ─────────────────────────────────────────────────────────

export type UserRole = 'admin' | 'member' | 'viewer'
export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'cancelled'
export type TaskPriority = 'high' | 'medium' | 'low'
export type NotificationChannel = 'email' | 'in_app'

export interface User {
  id: string
  email: string
  name: string
  role: UserRole
  createdAt: Date
}

export interface Task {
  id: string
  title: string
  description?: string
  status: TaskStatus
  priority: TaskPriority
  assigneeId?: string
  creatorId: string
  projectId: string
  dueDate?: Date
  createdAt: Date
  updatedAt: Date
}

export interface Project {
  id: string
  name: string
  ownerId: string
  memberIds: string[]
  createdAt: Date
}

export interface Notification {
  id: string
  userId: string
  message: string
  channel: NotificationChannel
  read: boolean
  createdAt: Date
}

// ── Mock in-memory database ───────────────────────────────────────────────────

const users: Map<string, User> = new Map([
  ['u1', { id: 'u1', email: 'alice@example.com', name: 'Alice',   role: 'admin',  createdAt: new Date() }],
  ['u2', { id: 'u2', email: 'bob@example.com',   name: 'Bob',     role: 'member', createdAt: new Date() }],
  ['u3', { id: 'u3', email: 'carol@example.com', name: 'Carol',   role: 'viewer', createdAt: new Date() }],
])

const tasks: Map<string, Task> = new Map([
  ['t1', {
    id: 't1', title: 'Setup CI pipeline', status: 'done', priority: 'high',
    creatorId: 'u1', projectId: 'p1', createdAt: new Date(), updatedAt: new Date()
  }],
  ['t2', {
    id: 't2', title: 'Write API docs', status: 'in_progress', priority: 'medium',
    assigneeId: 'u2', creatorId: 'u1', projectId: 'p1', createdAt: new Date(), updatedAt: new Date()
  }],
])

const projects: Map<string, Project> = new Map([
  ['p1', { id: 'p1', name: 'modmap', ownerId: 'u1', memberIds: ['u1', 'u2'], createdAt: new Date() }],
])

const notifications: Map<string, Notification> = new Map()

// ── DB client ─────────────────────────────────────────────────────────────────

export const db = {
  users: {
    findById:    (id: string)        => users.get(id) ?? null,
    findByEmail: (email: string)     => [...users.values()].find(u => u.email === email) ?? null,
    findAll:     ()                  => [...users.values()],
    save:        (user: User)        => { users.set(user.id, user); return user },
  },

  tasks: {
    findById:      (id: string)             => tasks.get(id) ?? null,
    findByProject: (projectId: string)      => [...tasks.values()].filter(t => t.projectId === projectId),
    findByAssignee:(userId: string)         => [...tasks.values()].filter(t => t.assigneeId === userId),
    save:          (task: Task)             => { tasks.set(task.id, task); return task },
    delete:        (id: string)             => tasks.delete(id),
  },

  projects: {
    findById:   (id: string)       => projects.get(id) ?? null,
    findAll:    ()                 => [...projects.values()],
    save:       (p: Project)       => { projects.set(p.id, p); return p },
  },

  notifications: {
    findByUser: (userId: string)        => [...notifications.values()].filter(n => n.userId === userId),
    save:       (n: Notification)       => { notifications.set(n.id, n); return n },
    markRead:   (id: string)            => {
      const n = notifications.get(id)
      if (n) { n.read = true; notifications.set(id, n) }
    },
  },
}

```

## auth/ (full code)
```typescript
// ── auth.service.ts ──
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

```

## notifications/ (full code)
```typescript
// ── notifications.service.ts ──
import { db } from '../database/db.client'
import type { Notification, NotificationChannel } from '../database/db.client'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AlertPayload {
  userId: string
  message: string
  channel?: NotificationChannel
}

export interface NotificationSummary {
  total: number
  unread: number
  items: Notification[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateId(): string {
  return 'notif_' + Math.random().toString(36).slice(2)
}

function deliverEmail(userId: string, message: string): void {
  // In production: call SendGrid / SES / etc.
  console.log(`[EMAIL] → user:${userId} | ${message}`)
}

function deliverInApp(notification: Notification): void {
  // In production: push via WebSocket / SSE
  console.log(`[IN-APP] → user:${notification.userId} | ${notification.message}`)
}

// ── Notifications service ─────────────────────────────────────────────────────

export function sendAlert(payload: AlertPayload): Notification {
  const user = db.users.findById(payload.userId)
  if (!user) throw new Error(`Cannot notify unknown user: ${payload.userId}`)

  const channel: NotificationChannel = payload.channel ?? 'in_app'

  const notification: Notification = {
    id: generateId(),
    userId: payload.userId,
    message: payload.message,
    channel,
    read: false,
    createdAt: new Date(),
  }

  db.notifications.save(notification)

  if (channel === 'email') {
    deliverEmail(user.email, payload.message)
  } else {
    deliverInApp(notification)
  }

  return notification
}

export function emailUser(userId: string, message: string): Notification {
  return sendAlert({ userId, message, channel: 'email' })
}

export function getNotifications(userId: string): NotificationSummary {
  const items = db.notifications.findByUser(userId)
  return {
    total: items.length,
    unread: items.filter(n => !n.read).length,
    items,
  }
}

export function markAsRead(notificationId: string): void {
  db.notifications.markRead(notificationId)
}

```

## Other modules (interface stubs only — do not load full code)

### api/module.json
```json
{
  "name": "api",
  "version": "1.0.0",
  "description": "Framework-agnostic HTTP route handlers. Entry point for all client requests.",
  "files": ["api.handlers.ts"],
  "exports": {
    "route": "(req: ApiRequest) => ApiResponse — main router, dispatches all requests",
    "handleLogin": "(req: ApiRequest) => ApiResponse",
    "handleLogout": "(req: ApiRequest) => ApiResponse",
    "handleMe": "(req: ApiRequest) => ApiResponse",
    "handleCreateTask": "(req: ApiRequest) => ApiResponse",
    "handleUpdateTask": "(req: ApiRequest) => ApiResponse",
    "handleAssignTask": "(req: ApiRequest) => ApiResponse",
    "handleCompleteTask": "(req: ApiRequest) => ApiResponse",
    "handleDeleteTask": "(req: ApiRequest) => ApiResponse",
    "handleGetTask": "(req: ApiRequest) => ApiResponse",
    "handleGetProjectTasks": "(req: ApiRequest) => ApiResponse",
    "handleGetMyTasks": "(req: ApiRequest) => ApiResponse",
    "handleGetNotifications": "(req: ApiRequest) => ApiResponse",
    "handleMarkNotificationRead": "(req: ApiRequest) => ApiResponse"
  },
  "imports": {
    "auth": ["login", "logout", "getCurrentUser"],
    "tasks": ["createTask", "updateTask", "assignTask", "completeTask", "deleteTask", "getTask", "getProjectTasks", "getMyTasks"],
    "notifications": ["getNotifications", "markAsRead"]
  },
  "types": {
    "ApiRequest": "{ method, path, headers, body?, params?, query? }",
    "ApiResponse": "{ status: number; body: unknown }"
  },
  "env": [],
  "status": "stable",
  "lastModified": "2026-04-14"
}

```

## Your task
add priority field to tasks

Rules:
- Only modify files in: tasks
- Update module.json if you add/change/remove any exports
- If this task requires changes to other modules, list them and stop — I will start a new session for each
- After completing, output a brief handover summary