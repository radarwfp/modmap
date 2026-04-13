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
