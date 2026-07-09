#!/usr/bin/env node

const { RELAY_SERVER } = require('./config');
const { displayHelp } = require('./utils');
const { startHosting } = require('./host');
const { connectToHost } = require('./client');

// Command handler
const command = process.argv[2];
const args = process.argv.slice(3);

if (command === 'host' || command === 'h') {
  const password = args[0];
  
  if (!password) {
    const { colors, log } = require('./config');
    console.log(`\n${colors.bgRed}${colors.white} ERROR ${colors.reset} Password required for hosting\n`);
    log.info('Usage: rcmd host <password>');
    console.log(`  ${colors.dim}Example: rcmd host mysecretpass${colors.reset}\n`);
    process.exit(1);
  }
  
  startHosting(password);
} 
else if (command === 'connect' || command === 'c') {
  const sessionId = args[0];
  const password = args[1];
  
  if (!sessionId || !password) {
    const { colors, log } = require('./config');
    console.log(`\n${colors.bgRed}${colors.white} ERROR ${colors.reset} Session ID and password required\n`);
    log.info('Usage: rcmd connect <session-id> <password>');
    console.log(`  ${colors.dim}Example: rcmd connect abc123 mysecretpass${colors.reset}\n`);
    process.exit(1);
  }
  
  connectToHost(sessionId, password);
} 
else {
  displayHelp(RELAY_SERVER);
}