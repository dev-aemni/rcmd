const readline = require('readline');
const WebSocket = require('ws');
const { colors, log } = require('./config');
const { generateToken, createWsUrl } = require('./utils');
const { RELAY_SERVER } = require('./config');

function connectToHost(sessionId, password) {
  const token = generateToken(password);
  
  displayClientBanner(sessionId);
  
  const wsUrl = createWsUrl(RELAY_SERVER, sessionId, 'client', token);
  const ws = new WebSocket(wsUrl);
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  let connected = false;
  let pingInterval;
  let currentPrompt = 'connecting...> ';
  let pingStartTime = null;
  
  ws.on('open', () => {
    log.success('Connected to relay server');
    console.log(`${colors.dim}Waiting for host to accept connection...${colors.reset}\n`);
    
    pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, 30000);
    
    ws.on('message', (data) => {
      handleMessage(ws, data, rl, pingInterval);
    });
  });
  
  ws.on('error', (error) => {
    clearInterval(pingInterval);
    log.error(`Connection failed: ${error.message}`);
    process.exit(1);
  });
  
  ws.on('close', (code) => {
    clearInterval(pingInterval);
    if (!connected) {
      displayConnectionError();
    }
    process.exit(0);
  });
}

function handleMessage(ws, data, rl, pingInterval) {
  try {
    const message = JSON.parse(data.toString());
    
    if (message.type === 'metadata') {
      connected = true;
      clearInterval(pingInterval);
      displayRemoteSystemInfo(message.data);
      askCommand(ws, rl, pingInterval);
    }
    else if (message.type === 'command_result') {
      if (message.output && message.output.trim()) {
        console.log(message.output);
      }
      if (message.prompt) {
        currentPrompt = message.prompt;
      }
      askCommand(ws, rl, pingInterval);
    }
    else if (message.type === 'pong_response') {
      if (pingStartTime) {
        const latency = Date.now() - pingStartTime;
        console.log(`${colors.green}✓${colors.reset} Pong! Latency: ${colors.bright}${latency}ms${colors.reset}`);
        pingStartTime = null;
      }
      askCommand(ws, rl, pingInterval);
    }
    else if (message.type === 'host_disconnected') {
      console.log(`\n${colors.red}Host disconnected${colors.reset}`);
      rl.close();
      ws.close();
      process.exit(0);
    }
  } catch (error) {
    log.error(`Error: ${error.message}`);
  }
}

// THIS IS THE KEY FUNCTION - Special commands are handled HERE
function askCommand(ws, rl, pingInterval) {
  rl.question(`${colors.green}${currentPrompt}${colors.reset}`, (input) => {
    const cmd = input.trim();
    
    // === SPECIAL COMMANDS - Handled locally, NOT sent to host ===
    
    if (cmd === '//exit' || cmd === '//quit') {
      console.log(`${colors.green}✓${colors.reset} Disconnected`);
      rl.close();
      clearInterval(pingInterval);
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1000, 'Client disconnected');
      }
      process.exit(0);
    }
    
    else if (cmd === '//ping') {
      console.log(`${colors.cyan}ℹ${colors.reset} Pinging host...`);
      pingStartTime = Date.now();
      ws.send(JSON.stringify({ type: 'ping_request' }));
      // Don't call askCommand here - wait for pong_response
    }
    
    else if (cmd === '//help') {
      console.log(`\n${colors.bright}Special Commands:${colors.reset}`);
      console.log(`  ${colors.green}//exit${colors.reset}  - Disconnect`);
      console.log(`  ${colors.green}//ping${colors.reset}  - Check latency`);
      console.log(`  ${colors.green}//help${colors.reset}  - Show this help`);
      console.log(`  ${colors.green}//clear${colors.reset} - Clear screen\n`);
      askCommand(ws, rl, pingInterval);
    }
    
    else if (cmd === '//clear' || cmd === '//cls') {
      console.clear();
      askCommand(ws, rl, pingInterval);
    }
    
    // === REGULAR COMMAND - Send to host ===
    else if (cmd && ws.readyState === WebSocket.OPEN && connected) {
      ws.send(JSON.stringify({
        type: 'client_command',
        command: input
      }));
      // Don't call askCommand here - wait for command_result
    }
    
    else {
      askCommand(ws, rl, pingInterval);
    }
  });
}

let currentPrompt = 'rcmd> ';
let connected = false;
let pingStartTime = null;

function displayClientBanner(sessionId) {
  console.log(`\n${colors.bgBlue}${colors.black}${colors.bright}                  CONNECTING TO HOST                  ${colors.reset}\n`);
  log.info(`Connecting to session: ${colors.bright}${sessionId}${colors.reset}`);
}

function displayConnectionError() {
  console.log(`\n${colors.red}✗${colors.reset} Could not connect to host`);
  console.log(`${colors.dim}  Check: Session ID, Password, Host status${colors.reset}\n`);
}

function displayRemoteSystemInfo(m) {
  console.log(`\n${colors.bgGreen}${colors.black}${colors.bright}                  REMOTE SYSTEM INFO                   ${colors.reset}\n`);
  
  log.section('📋 System');
  console.log(`  ${colors.cyan}•${colors.reset} OS:        ${colors.white}${m.os.platform} ${m.os.release}${colors.reset} ${colors.dim}(${m.os.arch})${colors.reset}`);
  console.log(`  ${colors.cyan}•${colors.reset} Hostname:  ${colors.white}${m.os.hostname}${colors.reset}`);
  
  log.section('👤 User');
  console.log(`  ${colors.cyan}•${colors.reset} Username:  ${colors.white}${m.user.username}${colors.reset}`);
  console.log(`  ${colors.cyan}•${colors.reset} Shell:     ${colors.white}${m.user.shell}${colors.reset}`);
  
  log.section('💻 Hardware');
  console.log(`  ${colors.cyan}•${colors.reset} Cores:     ${colors.white}${m.hardware.cpus}${colors.reset}`);
  console.log(`  ${colors.cyan}•${colors.reset} Memory:    ${colors.white}${(m.hardware.totalMemory / 1024 / 1024 / 1024).toFixed(2)} GB${colors.reset}`);
  
  console.log(`\n${colors.bgCyan}${colors.black}${colors.bright}                                                    ${colors.reset}`);
  console.log(`${colors.bright}${colors.white}  //exit  //ping  //help  //clear           ${colors.reset}`);
  console.log(`${colors.bgCyan}${colors.black}${colors.bright}                                                    ${colors.reset}\n`);
}

module.exports = {
  connectToHost
};