// SQL helpers: LIKE escaping, pagination and a tiny parameter builder for dynamic WHERE clauses.

export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export function likePattern(value: string): string {
  return `%${escapeLike(value)}%`;
}

export function offsetOf(page: number, pageSize: number): number {
  return (page - 1) * pageSize;
}

export function listMeta(page: number, pageSize: number, total: number) {
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Collects parameterised conditions: `w.add('b.status = any($?)', statuses)` → '$3'. Values are never interpolated. */
export class Where {
  readonly params: unknown[];
  private readonly parts: string[] = [];
  constructor(initial: unknown[] = []) {
    this.params = [...initial];
  }
  /** Adds a condition; every `$?` is replaced by the next positional parameter. */
  add(fragment: string, ...values: unknown[]): this {
    let i = 0;
    const sql = fragment.replace(/\$\?/g, () => {
      this.params.push(values[i++]);
      return `$${this.params.length}`;
    });
    this.parts.push(sql);
    return this;
  }
  param(value: unknown): string {
    this.params.push(value);
    return `$${this.params.length}`;
  }
  sql(prefix = 'where'): string {
    return this.parts.length ? `${prefix} ${this.parts.join(' and ')}` : '';
  }
}
