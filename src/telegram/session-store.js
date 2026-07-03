export class SessionStore {
  constructor() {
    this.sessions = new Map();
  }

  get(userId) {
    return this.sessions.get(String(userId)) || {};
  }

  set(userId, patch) {
    const key = String(userId);
    const current = this.get(key);
    const next = { ...current, ...patch };
    this.sessions.set(key, next);
    return next;
  }

  clear(userId) {
    this.sessions.delete(String(userId));
  }
}
