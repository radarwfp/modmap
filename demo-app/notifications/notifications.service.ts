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
