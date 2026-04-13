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
