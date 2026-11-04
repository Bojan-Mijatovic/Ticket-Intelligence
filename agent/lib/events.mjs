// Append-only event log (state/events.jsonl) plus live subscribers (the dashboard's server-sent events).

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function createEventLog(file) {
  mkdirSync(dirname(file), { recursive: true });
  const subscribers = new Set();
  return {
    emit(type, data = {}) {
      const event = { at: new Date().toISOString(), type, ...data };
      appendFileSync(file, `${JSON.stringify(event)}\n`);
      for (const fn of subscribers) fn(event);
      const tag = data.key ? `${data.key} ` : '';
      console.log(`${new Date().toLocaleTimeString('en-GB')} ${type.padEnd(16)} ${tag}${data.text ?? data.step ?? ''}`);
      return event;
    },
    history(limit = 500) {
      if (!existsSync(file)) return [];
      return readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(-limit).map((l) => JSON.parse(l));
    },
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
  };
}
