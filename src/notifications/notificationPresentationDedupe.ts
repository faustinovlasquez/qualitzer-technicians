import { notificationDataSchema } from "../domain/notifications";

export class NotificationPresentationDedupe {
  private readonly presented = new Map<string, number>();
  constructor(private readonly now: () => number = Date.now) {}

  accept(value: unknown): boolean {
    const parsed = notificationDataSchema.safeParse(value);
    if (!parsed.success) return false;
    const now = this.now();
    for (const [key, expires] of this.presented) if (expires <= now) this.presented.delete(key);
    const data = parsed.data;
    const key = JSON.stringify([data.tenantOrigin, data.companyBranchId, data.eventId]);
    if (this.presented.has(key)) return false;
    this.presented.set(key, now + 86400000);
    while (this.presented.size > 512) {
      const first = this.presented.keys().next().value;
      if (first !== undefined) this.presented.delete(first);
    }
    return true;
  }
}