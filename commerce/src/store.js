export class OrderStore {
  constructor(db) { this.db = db; }
  get(id) { return this.db.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first(); }
  bySession(id) { return this.db.prepare('SELECT * FROM orders WHERE stripe_session_id = ?').bind(id).first(); }
  async create(order) {
    await this.db.prepare(`INSERT OR IGNORE INTO orders
      (id, shop_id, product_id, variant_id, unit_amount, shipping_amount, countries, live, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(order.id, order.shop_id, order.product_id,
      order.variant_id, order.unit_amount, order.shipping_amount, order.countries, order.live,
      Date.now(), Date.now()).run();
    return this.get(order.id);
  }
  async attachSession(id, sessionId) {
    await this.db.prepare(`UPDATE orders SET stripe_session_id = ?, updated_at = ?
      WHERE id = ? AND (stripe_session_id IS NULL OR stripe_session_id = ?)`)
      .bind(sessionId, Date.now(), id, sessionId).run();
  }
  async markPaid(id) {
    await this.db.prepare(`UPDATE orders SET state = 'paid', updated_at = ?
      WHERE id = ? AND state = 'checkout'`).bind(Date.now(), id).run();
  }
  async claim(id) {
    const now = Date.now();
    const result = await this.db.prepare(`UPDATE orders SET lease_until = ?, attempts = attempts + 1,
      updated_at = ? WHERE id = ? AND lease_until < ? AND next_attempt <= ?
      AND state IN ('paid', 'retry', 'submitting', 'reconciling')`)
      .bind(now + 180000, now, id, now, now).run();
    return result.meta.changes === 1 ? this.get(id) : null;
  }
  async update(id, fields) {
    const allowed = new Set(['state', 'printify_order_id', 'lease_until', 'next_attempt', 'error_code']);
    const entries = Object.entries(fields);
    if (entries.some(([key]) => !allowed.has(key))) throw new Error('Invalid order field');
    await this.db.prepare(`UPDATE orders SET ${entries.map(([key]) => `${key} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
      .bind(...entries.map(([, value]) => value), Date.now(), id).run();
  }
  async pending() {
    const result = await this.db.prepare(`SELECT id FROM orders
      WHERE state IN ('paid', 'retry', 'submitting', 'reconciling') AND lease_until < ? AND next_attempt <= ?
      ORDER BY updated_at LIMIT 10`).bind(Date.now(), Date.now()).all();
    return result.results;
  }
}
