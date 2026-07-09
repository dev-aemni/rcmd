const crypto = require('crypto');

/**
 * Generate consistent session ID from password
 * @param {string} password - Session password
 * @returns {string} 8-character session ID
 */
function generateSessionId(password) {
  return crypto.createHash('sha256')
    .update('rcmd-session-v2-' + password)
    .digest('hex')
    .substring(0, 8);
}

/**
 * Generate consistent authentication token from password
 * @param {string} password - Session password
 * @returns {string} 16-character token
 */
function generateToken(password) {
  return crypto.createHash('sha256')
    .update('rcmd-token-v2-' + password)
    .digest('hex')
    .substring(0, 16);
}

/**
 * Create WebSocket URL with query parameters
 * @param {string} baseUrl - Relay server URL
 * @param {string} sessionId - Session ID
 * @param {string} role - 'host' or 'client'
 * @param {string} token - Authentication token
 * @returns {string} Complete WebSocket URL
 */
function createWsUrl(baseUrl, sessionId, role, token) {
  const wsBase = baseUrl.replace(/^http/, 'ws');
  return `${wsBase}?session=${sessionId}&role=${role}&token=${token}`;
}

/**
 * Display help information
 * @param {string} relayServer - Relay server URL
 */
function displayHelp(relayServer) {
  const { colors, borders } = require('./config');
  
  console.log(`
${colors.bgCyan}${colors.black}${colors.bright}${borders.top}${colors.reset}
${colors.bgCyan}${colors.black}${colors.bright}║      RCMD - Remote Terminal Access v2.0           ║${colors.reset}
${colors.bgCyan}${colors.black}${colors.bright}${borders.bottom}${colors.reset}

${colors.bright}${colors.cyan}Commands:${colors.reset}
  ${colors.green}rcmd host${colors.reset} ${colors.yellow}<password>${colors.reset}        Start hosting your terminal
  ${colors.green}rcmd connect${colors.reset} ${colors.yellow}<session-id> <password>${colors.reset}  Connect to a remote terminal

${colors.bright}${colors.cyan}Shortcuts:${colors.reset}
  ${colors.green}rcmd h${colors.reset} ${colors.yellow}<password>${colors.reset}          Host (short form)
  ${colors.green}rcmd c${colors.reset} ${colors.yellow}<session-id> <password>${colors.reset}  Connect (short form)

${colors.bright}${colors.cyan}Examples:${colors.reset}
  ${colors.dim}>${colors.reset} rcmd host mysecretpass
  ${colors.dim}>${colors.reset} rcmd connect abc123 mysecretpass

${colors.bright}${colors.cyan}Relay Server:${colors.reset} ${colors.dim}${relayServer}${colors.reset}
  ${colors.dim}Change with: set RCMD_RELAY=https://your-server.com${colors.reset}
`);
  process.exit(0);
}

module.exports = {
  generateSessionId,
  generateToken,
  createWsUrl,
  displayHelp
};