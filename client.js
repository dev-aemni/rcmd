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
      handleClientMessage(ws, data, rl, pingInterval, connected, currentPrompt, pingStartTime);
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

function displayClientBanner(sessionId) {
  console.log(`\n${colors.bgBlue}${colors.black}${colors.bright}                  CONNECTING TO HOST                  ${colors.reset}\n`);
  log.info(`Connecting to session: ${colors.bright}${sessionId}${colors.reset}`);
}

function displayConnectionError() {
  console.log(`\n${colors.red}✗${colors.reset} Could not connect to host`);
  console.log(`${colors.dim}  Check: Session ID, Password, Host status${colors.reset}\n`);
}

function handleClientMessage(ws, data, rl, pingInterval, connected, currentPrompt, pingStartTime) {
  try {
    const message = JSON.parse(data.toString());
    
    switch (message.type) {
      case 'metadata':
        connected = true;
        clearInterval(pingInterval);
        displayRemoteSystemInfo(message.data);
        promptCommand(ws, rl, pingInterval, connected, currentPrompt, pingStartTime);
        break;
        
      case 'command_result':
        if (message.output && message.output.trim()) {
          console.log(message.output);
        }
        if (message.prompt) {
          currentPrompt = message.prompt;
        }
        promptCommand(ws, rl, pingInterval, connected, currentPrompt, pingStartTime);
        break;
        
      case 'pong_response':
        if (pingStartTime) {
          const latency = Date.now() - pingStartTime;
          console.log(`${colors.green}✓${colors.reset} Pong! Latency: ${colors.bright}${latency}ms${colors.reset}`);
          pingStartTime = null;
        }
        promptCommand(ws, rl, pingInterval, connected, currentPrompt, pingStartTime);
        break;
        
      case 'host_disconnected':
        console.log(`\n${colors.yellow}⚠${colors.reset} ${colors.red}Host disconnected${colors.reset}`);
        rl.close();
        ws.close();
        process.exit(0);
        break;
    }
  } catch (error) {
    log.error(`Error: ${error.message}`);
  }
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
  console.log(`${colors.bright}${colors.white}  Special Commands:                         ${colors.reset}`);
  console.log(`${colors.bright}${colors.white}  //exit  - Disconnect                      ${colors.reset}`);
  console.log(`${colors.bright}${colors.white}  //ping  - Check latency                    ${colors.reset}`);
  console.log(`${colors.bright}${colors.white}  //help  - Show this help                   ${colors.reset}`);
  console.log(`${colors.bgCyan}${colors.black}${colors.bright}                                                    ${colors.reset}\n`);
}

function promptCommand(ws, rl, pingInterval, connected, currentPrompt, pingStartTime) {
  rl.question(`${colors.green}${currentPrompt}${colors.reset}`, (input) => {
    const trimmedInput = input.trim();
    
    // Handle special client-side commands (NOT sent to host)
    if (trimmedInput === '//exit' || trimmedInput === '//quit') {
      console.log(`\n${colors.green}✓${colors.reset} Disconnected`);
      rl.close();
      clearInterval(pingInterval);
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1000, 'Client disconnected');
      }
      process.exit(0);
      return;
    }
    
    if (trimmedInput === '//ping') {
      console.log(`${colors.cyan}ℹ${colors.reset} Pinging host...`);
      pingStartTime = Date.now();
      ws.send(JSON.stringify({
        type: 'ping_request'
      }));
      return;
    }
    
    if (trimmedInput === '//help') {
      console.log(`\n${colors.bright}${colors.white}Special Commands:${colors.reset}`);
      console.log(`  ${colors.green}//exit${colors.reset}  - Disconnect from host`);
      console.log(`  ${colors.green}//ping${colors.reset}  - Check connection latency`);
      console.log(`  ${colors.green}//help${colors.reset}  - Show this help`);
      console.log(`  ${colors.green}//clear${colors.reset} - Clear screen\n`);
      promptCommand(ws, rl, pingInterval, connected, currentPrompt, pingStartTime);
      return;
    }
    
    if (trimmedInput === '//clear' || trimmedInput === '//cls') {
      console.clear();
      promptCommand(ws, rl, pingInterval, connected, currentPrompt, pingStartTime);
      return;
    }
    
    // Send regular commands to host
    if (trimmedInput && ws.readyState === WebSocket.OPEN && connected) {
      ws.send(JSON.stringify({
        type: 'client_command',
        command: input
      }));
    } else if (!connected) {
      log.warn('Not yet connected to host');
      promptCommand(ws, rl, pingInterval, connected, currentPrompt, pingStartTime);
    } else {
      promptCommand(ws, rl, pingInterval, connected, currentPrompt, pingStartTime);
    }
  });
}

module.exports = {
  connectToHost
};