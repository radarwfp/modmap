import { login, logout, getCurrentUser } from '../auth/auth.service'
import {
  createTask, updateTask, assignTask,
  completeTask, deleteTask, getTask,
  getProjectTasks, getMyTasks
} from '../tasks/tasks.service'
import { getNotifications, markAsRead } from '../notifications/notifications.service'

// ── Minimal request/response types (framework-agnostic) ───────────────────────

export interface ApiRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  headers: Record<string, string>
  body?: unknown
  params?: Record<string, string>
  query?: Record<string, string>
}

export interface ApiResponse {
  status: number
  body: unknown
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function ok(body: unknown): ApiResponse       { return { status: 200, body } }
function created(body: unknown): ApiResponse  { return { status: 201, body } }
function err(status: number, message: string): ApiResponse { return { status, body: { error: message } } }

function getToken(req: ApiRequest): string {
  const auth = req.headers['authorization'] ?? ''
  return auth.replace('Bearer ', '').trim()
}

// ── Route handlers ────────────────────────────────────────────────────────────

export function handleLogin(req: ApiRequest): ApiResponse {
  try {
    const { email, password } = req.body as { email: string; password: string }
    const result = login(email, password)
    return result.success ? ok(result.token) : err(401, result.error ?? 'Login failed')
  } catch (e) {
    return err(400, (e as Error).message)
  }
}

export function handleLogout(req: ApiRequest): ApiResponse {
  logout(getToken(req))
  return ok({ message: 'Logged out' })
}

export function handleMe(req: ApiRequest): ApiResponse {
  const user = getCurrentUser(getToken(req))
  return user ? ok(user) : err(401, 'Unauthorized')
}

export function handleCreateTask(req: ApiRequest): ApiResponse {
  try {
    const task = createTask(getToken(req), req.body as Parameters<typeof createTask>[1])
    return created(task)
  } catch (e) {
    return err(400, (e as Error).message)
  }
}

export function handleUpdateTask(req: ApiRequest): ApiResponse {
  try {
    const taskId = req.params?.taskId ?? ''
    const task = updateTask(getToken(req), taskId, req.body as Parameters<typeof updateTask>[2])
    return ok(task)
  } catch (e) {
    return err(400, (e as Error).message)
  }
}

export function handleAssignTask(req: ApiRequest): ApiResponse {
  try {
    const { taskId, assigneeId } = req.params ?? {}
    return ok(assignTask(getToken(req), taskId, assigneeId))
  } catch (e) {
    return err(400, (e as Error).message)
  }
}

export function handleCompleteTask(req: ApiRequest): ApiResponse {
  try {
    return ok(completeTask(getToken(req), req.params?.taskId ?? ''))
  } catch (e) {
    return err(400, (e as Error).message)
  }
}

export function handleDeleteTask(req: ApiRequest): ApiResponse {
  try {
    deleteTask(getToken(req), req.params?.taskId ?? '')
    return ok({ message: 'Task deleted' })
  } catch (e) {
    const msg = (e as Error).message
    return err(msg.includes('Forbidden') ? 403 : 400, msg)
  }
}

export function handleGetTask(req: ApiRequest): ApiResponse {
  try {
    return ok(getTask(getToken(req), req.params?.taskId ?? ''))
  } catch (e) {
    return err(404, (e as Error).message)
  }
}

export function handleGetProjectTasks(req: ApiRequest): ApiResponse {
  try {
    return ok(getProjectTasks(getToken(req), req.params?.projectId ?? ''))
  } catch (e) {
    return err(400, (e as Error).message)
  }
}

export function handleGetMyTasks(req: ApiRequest): ApiResponse {
  try {
    return ok(getMyTasks(getToken(req)))
  } catch (e) {
    return err(401, (e as Error).message)
  }
}

export function handleGetNotifications(req: ApiRequest): ApiResponse {
  try {
    const user = getCurrentUser(getToken(req))
    if (!user) return err(401, 'Unauthorized')
    return ok(getNotifications(user.id))
  } catch (e) {
    return err(400, (e as Error).message)
  }
}

export function handleMarkNotificationRead(req: ApiRequest): ApiResponse {
  try {
    markAsRead(req.params?.notificationId ?? '')
    return ok({ message: 'Marked as read' })
  } catch (e) {
    return err(400, (e as Error).message)
  }
}

// ── Router ────────────────────────────────────────────────────────────────────

export function route(req: ApiRequest): ApiResponse {
  const { method, path } = req

  if (method === 'POST'   && path === '/auth/login')                         return handleLogin(req)
  if (method === 'POST'   && path === '/auth/logout')                        return handleLogout(req)
  if (method === 'GET'    && path === '/auth/me')                            return handleMe(req)
  if (method === 'POST'   && path === '/tasks')                              return handleCreateTask(req)
  if (method === 'PATCH'  && path.startsWith('/tasks/') && path.endsWith('/complete')) return handleCompleteTask(req)
  if (method === 'PATCH'  && path.startsWith('/tasks/') && path.endsWith('/assign'))   return handleAssignTask(req)
  if (method === 'PATCH'  && path.startsWith('/tasks/'))                     return handleUpdateTask(req)
  if (method === 'DELETE' && path.startsWith('/tasks/'))                     return handleDeleteTask(req)
  if (method === 'GET'    && path === '/tasks/me')                           return handleGetMyTasks(req)
  if (method === 'GET'    && path.startsWith('/tasks/'))                     return handleGetTask(req)
  if (method === 'GET'    && path.startsWith('/projects/'))                  return handleGetProjectTasks(req)
  if (method === 'GET'    && path === '/notifications')                      return handleGetNotifications(req)
  if (method === 'PATCH'  && path.startsWith('/notifications/'))             return handleMarkNotificationRead(req)

  return err(404, `No route matched: ${method} ${path}`)
}
