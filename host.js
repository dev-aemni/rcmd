const os = require('os');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const { colors, log } = require('./config');
const { getSystemMetadata } = require('./metadata');
const { generateSessionId, generateToken, createWsUrl } = require('./utils');
const { RELAY_SERVER } = require('./config');

// Module-level variables for shell management
let shellProcess = null;
let commandOutput = '';
let isCollecting = false;
let isProcessing = false;
let shellReady = false;
let isWindows = os.platform() === 'win32';
let commandQueue = [];
let currentDir = process.cwd();

function startHosting(password) {
  const sessionId = generateSessionId(password);
  const token = generateToken(password);
  
  displayHostBanner(sessionId, password);
  
  const metadata = getSystemMetadata();
  displayHostSystemInfo(metadata);
  
  console.log(`${colors.dim}Connecting to relay server...${colors.reset}`);
  
  const wsUrl = createWsUrl(RELAY_SERVER, sessionId, 'host', token);
  const ws = new WebSocket(wsUrl);
  
  let pingInterval;
  let currentClientPeerId = null;
  
  ws.on('open', () => {
    log.success('Connected to relay server');
    log.success('Waiting for clients to connect...\n');
    
    startPersistentShell();
    
    pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, 30000);
    
    ws.on('message', (data) => {
      handleHostMessage(ws, data, metadata, currentClientPeerId);
    });
  });
  
  ws.on('error', (error) => {
    clearInterval(pingInterval);
    if (shellProcess) shellProcess.kill();
    log.error(`Connection failed: ${error.message}`);
    process.exit(1);
  });
  
  ws.on('close', (code) => {
    clearInterval(pingInterval);
    if (shellProcess) shellProcess.kill();
    console.log(`\n${colors.yellow}⚠${colors.reset} Disconnected from relay server`);
    process.exit(0);
  });
  
  process.on('SIGINT', () => {
    clearInterval(pingInterval);
    if (shellProcess) shellProcess.kill();
    if (ws.readyState === WebSocket.OPEN) {
      ws.close(1000, 'Host shutting down');
    }
    process.exit(0);
  });
}

function startPersistentShell() {
  if (isWindows) {
    shellProcess = spawn('cmd.exe', ['/q', '/k'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: currentDir,
      env: process.env,
      windowsHide: true
    });
    
    // Setup clean shell
    shellProcess.stdin.write('@echo off\n');
    shellProcess.stdin.write('prompt $P$G\n');
    shellProcess.stdin.write('cls\n');
  } else {
    shellProcess = spawn('/bin/bash', ['--norc', '--noprofile'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: currentDir,
      env: Object.assign({}, process.env, { 
        PS1: '\\u@\\h:\\w\\$ ',
        TERM: 'dumb'
      })
    });
  }
  
  shellProcess.stderr.on('data', (data) => {
    const text = data.toString();
    if (isCollecting) {
      commandOutput += text;
    }
  });
  
  shellProcess.stdout.on('data', (data) => {
    const text = data.toString();
    
    if (isCollecting) {
      commandOutput += text;
    }
    
    // Print to host console for monitoring (dimmed)
    process.stdout.write(`${colors.dim}${text}${colors.reset}`);
  });
  
  shellProcess.on('error', (err) => {
    log.error(`Shell error: ${err.message}`);
  });
  
  shellProcess.on('exit', (code) => {
    log.warn(`Shell exited with code ${code}`);
    shellReady = false;
    shellProcess = null;
    
    setTimeout(() => {
      if (!shellProcess) {
        log.info('Restarting shell...');
        startPersistentShell();
      }
    }, 1000);
  });
  
  setTimeout(() => {
    shellReady = true;
    processNextCommand();
  }, 500);
}

function handleHostMessage(ws, data, metadata, currentClientPeerId) {
  try {
    const message = JSON.parse(data.toString());
    
    switch (message.type) {
      case 'request_metadata':
        log.info('Client connected, sending system info...');
        ws.send(JSON.stringify({
          type: 'metadata_response',
          data: metadata
        }));
        log.success('Client connected successfully!\n');
        
        setTimeout(() => {
          ws.send(JSON.stringify({
            type: 'command_result',
            output: '',
            success: true,
            targetPeerId: currentClientPeerId,
            prompt: getPrompt()
          }));
        }, 300);
        break;
        
      case 'ping_request':
        // Respond to ping immediately
        ws.send(JSON.stringify({
          type: 'pong_response',
          targetPeerId: currentClientPeerId
        }));
        break;
        
      case 'client_command':
        currentClientPeerId = message.fromPeerId;
        executeCommand(ws, message.command, currentClientPeerId);
        break;
    }
  } catch (error) {
    log.error(`Error: ${error.message}`);
  }
}

function executeCommand(ws, command, peerId) {
  console.log(`${colors.bright}${colors.cyan}>${colors.reset} ${colors.white}${command}${colors.reset}`);
  
  // Handle cd command specially
  if (command.trim().toLowerCase().startsWith('cd')) {
    handleCdCommand(ws, command.trim(), peerId);
    return;
  }
  
  commandQueue.push({ ws, command, peerId });
  processNextCommand();
}

function processNextCommand() {
  if (isProcessing || commandQueue.length === 0 || !shellReady || !shellProcess) {
    return;
  }
  
  isProcessing = true;
  const { ws, command, peerId } = commandQueue.shift();
  
  commandOutput = '';
  isCollecting = true;
  
  const endMarker = `__RCMD_END_${Date.now()}__`;
  const fullCommand = isWindows 
    ? `(${command}) & echo ${endMarker}\n`
    : `(${command}); echo "${endMarker}"\n`;
  
  shellProcess.stdin.write(fullCommand);
  
  const checkInterval = setInterval(() => {
    if (commandOutput.includes(endMarker)) {
      clearInterval(checkInterval);
      isCollecting = false;
      
      let cleanOutput = commandOutput.split(endMarker)[0];
      // Clean up prompt artifacts
      cleanOutput = cleanOutput
        .replace(/>\s*$/, '')
        .replace(/\n[^\n]*>\s*$/, '')
        .trim();
      
      ws.send(JSON.stringify({
        type: 'command_result',
        output: cleanOutput || '',
        success: true,
        targetPeerId: peerId,
        prompt: getPrompt()
      }));
      
      isProcessing = false;
      setTimeout(() => processNextCommand(), 50);
    }
  }, 50);
  
  setTimeout(() => {
    clearInterval(checkInterval);
    if (isCollecting) {
      isCollecting = false;
      ws.send(JSON.stringify({
        type: 'command_result',
        output: commandOutput || '(timeout)',
        success: false,
        targetPeerId: peerId,
        prompt: getPrompt()
      }));
      isProcessing = false;
      setTimeout(() => processNextCommand(), 50);
    }
  }, 30000);
}

function handleCdCommand(ws, command, peerId) {
  const parts = command.split(/\s+/);
  const newDir = parts.length > 1 ? parts.slice(1).join(' ') : os.homedir();
  
  try {
    let targetDir;
    
    if (newDir === '..') {
      targetDir = path.dirname(currentDir);
    } else if (newDir === '~' || newDir === '') {
      targetDir = os.homedir();
    } else if (path.isAbsolute(newDir)) {
      targetDir = newDir;
    } else {
      targetDir = path.resolve(currentDir, newDir);
    }
    
    if (fs.existsSync(targetDir)) {
      process.chdir(targetDir);
      currentDir = targetDir;
      
      if (isWindows) {
        shellProcess.stdin.write(`cd /d "${targetDir}"\n`);
      } else {
        shellProcess.stdin.write(`cd "${targetDir}"\n`);
      }
      
      ws.send(JSON.stringify({
        type: 'command_result',
        output: '',
        success: true,
        targetPeerId: peerId,
        prompt: getPrompt()
      }));
    } else {
      ws.send(JSON.stringify({
        type: 'command_result',
        output: `Path not found: ${newDir}`,
        success: false,
        targetPeerId: peerId,
        prompt: getPrompt()
      }));
    }
  } catch (err) {
    ws.send(JSON.stringify({
      type: 'command_result',
      output: err.message,
      success: false,
      targetPeerId: peerId,
      prompt: getPrompt()
    }));
  }
}

/**
 * Get formatted prompt showing current directory
 */
function getPrompt() {
  const hostname = os.hostname();
  const username = os.userInfo().username;
  const homedir = os.homedir();
  
  let displayPath = currentDir;
  
  // Replace home directory with ~
  if (currentDir.toLowerCase().startsWith(homedir.toLowerCase())) {
    displayPath = '~' + currentDir.substring(homedir.length);
  }
  
  // Use / for path separator on all platforms
  displayPath = displayPath.replace(/\\/g, '/');
  
  return `${username}@${hostname}:${displayPath}> `;
}

function displayHostBanner(sessionId, password) {
  console.log(`\n${colors.bgGreen}${colors.black}${colors.bright}                    HOSTING TERMINAL                    ${colors.reset}\n`);
  log.success(`Session ready`);
  console.log(`  ${colors.cyan}Session ID:${colors.reset}  ${colors.bright}${colors.yellow}${sessionId}${colors.reset}`);
  console.log(`  ${colors.cyan}Password:${colors.reset}    ${colors.bright}${colors.yellow}${'*'.repeat(password.length)}${colors.reset}`);
  console.log(`\n${colors.bright}${colors.cyan}Share this command to connect:${colors.reset}`);
  log.command(`rcmd connect ${sessionId} ${password}`);
}

function displayHostSystemInfo(metadata) {
  console.log(`\n${colors.bright}${colors.magenta}System Information:${colors.reset}`);
  console.log(`  ${colors.cyan}•${colors.reset} OS:       ${colors.white}${metadata.os.platform} ${metadata.os.release}${colors.reset}`);
  console.log(`  ${colors.cyan}•${colors.reset} Host:     ${colors.white}${metadata.os.hostname}${colors.reset}`);
  console.log(`  ${colors.cyan}•${colors.reset} User:     ${colors.white}${metadata.user.username}${colors.reset}`);
  console.log(`  ${colors.cyan}•${colors.reset} CPUs:     ${colors.white}${metadata.hardware.cpus}${colors.reset}`);
  console.log(`  ${colors.cyan}•${colors.reset} Memory:   ${colors.white}${(metadata.hardware.totalMemory / 1024 / 1024 / 1024).toFixed(2)} GB${colors.reset}`);
  if (metadata.os.isWSL) {
    console.log(`  ${colors.cyan}•${colors.reset} WSL:      ${colors.yellow}v${metadata.os.wslVersion} - ${metadata.os.wslDistro}${colors.reset}`);
  }
}

module.exports = {
  startHosting
};