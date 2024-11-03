import { writable } from 'svelte/store';

interface Message {
  status: 'info' | 'success' | 'warning' | 'error';
  message: string;
}

export const scriptErrorLog = writable<Message[]>([]);

export function postScriptMessage(status: Message['status'], message: string) {
  scriptErrorLog.update((log) => [...log, { status, message }]);
}

export function clearScriptMessages() {
  scriptErrorLog.set([]);
}