const path = require('path');
const os = require('os');

// Relay server URL
const RELAY_SERVER = process.env.RCMD_RELAY || 'https://rcmd-relay.onrender.com';

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  underscore: '\x1b[4m',
  blink: '\x1b[5m',
  reverse: '\x1b[7m',
  hidden: '\x1b[8m',
  
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  
  bgBlack: '\x1b[40m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
  bgWhite: '\x1b[47m'
};

// Helper functions for colored output
const log = {
  success: (msg) => console.log(`${colors.green}✓${colors.reset} ${msg}`),
  error: (msg) => console.log(`${colors.red}✗${colors.reset} ${msg}`),
  info: (msg) => console.log(`${colors.cyan}ℹ${colors.reset} ${msg}`),
  warn: (msg) => console.log(`${colors.yellow}⚠${colors.reset} ${msg}`),
  title: (msg) => console.log(`${colors.bright}${colors.cyan}${msg}${colors.reset}`),
  header: (msg) => console.log(`\n${colors.bgCyan}${colors.black}${colors.bright} ${msg} ${colors.reset}\n`),
  section: (msg) => console.log(`\n${colors.bright}${colors.magenta}${msg}${colors.reset}`),
  command: (msg) => console.log(`  ${colors.bright}${colors.green}>${colors.reset} ${colors.white}${msg}${colors.reset}`),
  dim: (msg) => console.log(`${colors.dim}${msg}${colors.reset}`),
  highlight: (msg) => `${colors.bright}${colors.yellow}${msg}${colors.reset}`,
  value: (msg) => `${colors.bright}${colors.white}${msg}${colors.reset}`,
};

// Border styles
const borders = {
  top: '╔══════════════════════════════════════════════╗',
  bottom: '╚══════════════════════════════════════════════╝',
  middle: '║                                              ║',
  single: '──────────────────────────────────────────────',
  double: '══════════════════════════════════════════════',
};

module.exports = {
  RELAY_SERVER,
  colors,
  log,
  borders
};