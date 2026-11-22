import { notifyStaff, notifyStaffNow } from './alerts.js';

const LEVEL_PRIORITY = { error: 0, warn: 1, info: 2, debug: 3 };

const RAW_LEVEL   = process.env.LOG_LEVEL?.toLowerCase() ?? 'info';
const ACTIVE_PRIO = LEVEL_PRIORITY[RAW_LEVEL] ?? LEVEL_PRIORITY.info;

const IS_TTY = Boolean(process.stdout.isTTY);

const ANSI = {
  error: '\x1b[31m',
  warn:  '\x1b[33m',
  info:  '\x1b[36m',
  debug: '\x1b[90m',
  reset: '\x1b[0m',
};

function format(level, message) {
  const timestamp = new Date().toISOString();
  const label     = level.toUpperCase().padEnd(5);

  if (IS_TTY) {
    return `${ANSI[level]}[${timestamp}] [${label}]${ANSI.reset} ${message}`;
  }
  return `[${timestamp}] [${label}] ${message}`;
}

let attachedClient = null;

const MIRROR_ICON = { error: '🔴', warn: '🟡', info: '🔵' };

function mirrorToDiscord(level, message) {
  if (!attachedClient) return;
  notifyStaff(attachedClient, `${MIRROR_ICON[level]} ${message}`).catch(() => {});
}

const logger = {
  attachClient(client) {
    attachedClient = client;
  },

  error(message) {
    if (ACTIVE_PRIO >= LEVEL_PRIORITY.error) {
      console.error(format('error', message));
      mirrorToDiscord('error', message);
    }
  },

  alert(message) {
    console.log(format('info', message));
    if (!attachedClient) return;
    notifyStaffNow(attachedClient, `🚨 ${message}`).catch(() => {});
  },

  warn(message) {
    if (ACTIVE_PRIO >= LEVEL_PRIORITY.warn) {
      console.warn(format('warn', message));
      mirrorToDiscord('warn', message);
    }
  },

  info(message) {
    if (ACTIVE_PRIO >= LEVEL_PRIORITY.info) {
      console.log(format('info', message));
      mirrorToDiscord('info', message);
    }
  },

  debug(message) {
    if (ACTIVE_PRIO >= LEVEL_PRIORITY.debug) {
      console.log(format('debug', message));
    }
  },
};

export default logger;
