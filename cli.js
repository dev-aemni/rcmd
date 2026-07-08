#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const readline = require('readline');
const { execSync } = require('child_process');
const WebSocket = require('ws');

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

const RELAY_SERVER = process.env.RCMD_RELAY || 'https://rcmd-relay.onrender.com';

// Command handler
const command = process.argv[2];
const args = process.argv.slice(3);

if (command === 'host' || command === 'h') {
  const password = args[0];
  
  if (!password) {
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
    console.log(`\n${colors.bgRed}${colors.white} ERROR ${colors.reset} Session ID and password required\n`);
    log.info('Usage: rcmd connect <session-id> <password>');
    console.log(`  ${colors.dim}Example: rcmd connect abc123 mysecretpass${colors.reset}\n`);
    process.exit(1);
  }
  
  connectToHost(sessionId, password);
} 
else {
  displayHelp();
}

function displayHelp() {
  console.log(`
${colors.bgCyan}${colors.black}${colors.bright}                                                    ${colors.reset}
${colors.bgCyan}${colors.black}${colors.bright}      RCMD - Remote Terminal Access v2.0           ${colors.reset}
${colors.bgCyan}${colors.black}${colors.bright}                                                    ${colors.reset}

${colors.bright}${colors.cyan}Commands:${colors.reset}
  ${colors.green}rcmd host${colors.reset} ${colors.yellow}<password>${colors.reset}        Start hosting your terminal
  ${colors.green}rcmd connect${colors.reset} ${colors.yellow}<session-id> <password>${colors.reset}  Connect to a remote terminal

${colors.bright}${colors.cyan}Examples:${colors.reset}
  ${colors.dim}>${colors.reset} rcmd host mysecretpass
  ${colors.dim}>${colors.reset} rcmd connect abc123 mysecretpass

${colors.bright}${colors.cyan}Relay Server:${colors.reset} ${colors.dim}${RELAY_SERVER}${colors.reset}
  ${colors.dim}Change with: set RCMD_RELAY=https://your-server.com${colors.reset}
`);
  process.exit(0);
}

// Generate consistent IDs from password
function generateSessionId(password) {
  return crypto.createHash('sha256')
    .update('rcmd-session-v2-' + password)
    .digest('hex')
    .substring(0, 8);
}

function generateToken(password) {
  return crypto.createHash('sha256')
    .update('rcmd-token-v2-' + password)
    .digest('hex')
    .substring(0, 16);
}

// Get detailed system metadata
function getSystemMetadata() {
  const metadata = {
    os: {
      platform: os.platform(),
      type: os.type(),
      release: os.release(),
      arch: os.arch(),
      version: os.version(),
      hostname: os.hostname(),
      uptime: os.uptime(),
      isWSL: false,
      wslVersion: null,
      wslDistro: null,
    },
    user: {
      username: os.userInfo().username,
      homedir: os.userInfo().homedir,
      shell: process.env.SHELL || process.env.COMSPEC || 'unknown',
    },
    hardware: {
      cpus: os.cpus().length,
      cpuModel: os.cpus()[0]?.model || 'Unknown',
      totalMemory: os.totalmem(),
      freeMemory: os.freemem(),
      totalDisk: null,
      freeDisk: null,
    },
    software: {
      nodeVersion: process.version,
      npmVersion: null,
      gitVersion: null,
      pythonVersion: null,
      dockerVersion: null,
    },
    network: {
      ipv4: [],
      ipv6: [],
    },
    environment: {
      isDocker: false,
      isSSH: !!process.env.SSH_TTY,
      terminal: process.env.TERM || 'unknown',
    },
    timestamp: new Date().toISOString(),
  };

  const isWindows = os.platform() === 'win32';
  
  try {
    if (isWindows) {
      // Disk space
      try {
        const diskInfo = execSync('wmic logicaldisk where "DeviceID=\'C:\'" get Size,FreeSpace /format:csv 2>nul', { encoding: 'utf8' });
        const lines = diskInfo.trim().split('\n');
        if (lines.length >= 2) {
          const values = lines[1].split(',');
          if (values.length >= 3) {
            metadata.hardware.freeDisk = (parseInt(values[1]) / (1024*1024*1024)).toFixed(2) + ' GB';
            metadata.hardware.totalDisk = (parseInt(values[2]) / (1024*1024*1024)).toFixed(2) + ' GB';
          }
        }
      } catch {}
      
      // Tool versions
      try { metadata.software.npmVersion = execSync('npm --version 2>nul', { encoding: 'utf8' }).trim(); } catch {}
      try { metadata.software.gitVersion = execSync('git --version 2>nul', { encoding: 'utf8' }).trim(); } catch {}
      try { metadata.software.pythonVersion = execSync('python --version 2>nul', { encoding: 'utf8' }).trim(); } catch {}
      try { metadata.software.dockerVersion = execSync('docker --version 2>nul', { encoding: 'utf8' }).trim(); } catch {}
    } else {
      // Linux/Mac commands
      try {
        const wslCheck = execSync('cat /proc/version 2>/dev/null', { encoding: 'utf8' }).toLowerCase();
        if (wslCheck.includes('microsoft') || wslCheck.includes('wsl')) {
          metadata.os.isWSL = true;
          try {
            const releaseContent = fs.readFileSync('/etc/os-release', 'utf8');
            const nameMatch = releaseContent.match(/^NAME="?(.+?)"?$/m);
            if (nameMatch) metadata.os.wslDistro = nameMatch[1];
          } catch {}
        }
      } catch {}
      
      try {
        const diskInfo = execSync('df -h / 2>/dev/null | tail -1', { encoding: 'utf8' }).trim().split(/\s+/);
        if (diskInfo.length >= 4) {
          metadata.hardware.totalDisk = diskInfo[1];
          metadata.hardware.freeDisk = diskInfo[3];
        }
      } catch {}
      
      try { metadata.software.npmVersion = execSync('npm --version 2>/dev/null', { encoding: 'utf8' }).trim(); } catch {}
      try { metadata.software.gitVersion = execSync('git --version 2>/dev/null', { encoding: 'utf8' }).trim(); } catch {}
      try { metadata.software.pythonVersion = execSync('python3 --version 2>/dev/null || python --version 2>/dev/null', { encoding: 'utf8' }).trim(); } catch {}
      try { metadata.software.dockerVersion = execSync('docker --version 2>/dev/null', { encoding: 'utf8' }).trim(); } catch {}
      
      // Docker detection
      try {
        const cgroup = fs.readFileSync('/proc/1/cgroup', 'utf8');
        if (cgroup.includes('docker') || cgroup.includes('containerd')) {
          metadata.environment.isDocker = true;
        }
      } catch {}
    }
  } catch {}

  // Network interfaces
  try {
    const interfaces = os.networkInterfaces();
    for (const [name, netInfo] of Object.entries(interfaces)) {
      netInfo.forEach(addr => {
        if (addr.family === 'IPv4' && !addr.internal) {
          metadata.network.ipv4.push(addr.address);
        } else if (addr.family === 'IPv6' && !addr.internal) {
          metadata.network.ipv6.push(addr.address);
        }
      });
    }
  } catch {}

  return metadata;
}

// Start hosting terminal
function startHosting(password) {
  const sessionId = generateSessionId(password);
  const token = generateToken(password);
  
  console.log(`\n${colors.bgGreen}${colors.black}${colors.bright}                    HOSTING TERMINAL                    ${colors.reset}\n`);
  
  log.success(`Session ready`);
  console.log(`  ${colors.cyan}Session ID:${colors.reset}  ${colors.bright}${colors.yellow}${sessionId}${colors.reset}`);
  console.log(`  ${colors.cyan}Password:${colors.reset}    ${colors.bright}${colors.yellow}${password}${colors.reset}`);
  
  console.log(`\n${colors.bright}${colors.cyan}Share this command to connect:${colors.reset}`);
  log.command(`rcmd connect ${sessionId} ${password}`);
  
  // Collect and display metadata
  const metadata = getSystemMetadata();
  
  console.log(`\n${colors.bright}${colors.magenta}System Information:${colors.reset}`);
  console.log(`  ${colors.cyan}•${colors.reset} OS:       ${colors.white}${metadata.os.platform} ${metadata.os.release}${colors.reset}`);
  console.log(`  ${colors.cyan}•${colors.reset} Host:     ${colors.white}${metadata.os.hostname}${colors.reset}`);
  console.log(`  ${colors.cyan}•${colors.reset} User:     ${colors.white}${metadata.user.username}${colors.reset}`);
  console.log(`  ${colors.cyan}•${colors.reset} CPUs:     ${colors.white}${metadata.hardware.cpus}${colors.reset}`);
  console.log(`  ${colors.cyan}•${colors.reset} Memory:   ${colors.white}${(metadata.hardware.totalMemory / 1024 / 1024 / 1024).toFixed(2)} GB${colors.reset}`);
  
  if (metadata.os.isWSL) {
    console.log(`  ${colors.cyan}•${colors.reset} WSL:      ${colors.yellow}v${metadata.os.wslVersion} - ${metadata.os.wslDistro}${colors.reset}`);
  }
  
  console.log(`\n${colors.dim}Connecting to relay server...${colors.reset}`);
  
  // Connect to relay via WebSocket
  const wsUrl = `${RELAY_SERVER.replace(/^http/, 'ws')}?session=${sessionId}&role=host&token=${token}`;
  const ws = new WebSocket(wsUrl);
  
  let currentClientPeerId = null;
  let pingInterval;
  
  ws.on('open', () => {
    log.success('Connected to relay server');
    log.success('Waiting for clients to connect...\n');
    
    // Keep connection alive
    pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, 30000);
    
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        if (message.type === 'request_metadata') {
          log.info('Client connected, sending system info...');
          ws.send(JSON.stringify({
            type: 'metadata_response',
            data: metadata
          }));
          log.success('Client connected successfully!\n');
        }
        else if (message.type === 'client_command') {
          currentClientPeerId = message.fromPeerId;
          const command = message.command;
          
          console.log(`${colors.bright}${colors.cyan}>${colors.reset} ${colors.white}${command}${colors.reset}`);
          
          try {
            const shell = os.platform() === 'win32' ? 'cmd.exe' : '/bin/bash';
            const shellArg = os.platform() === 'win32' ? '/c' : '-c';
            
            const output = execSync(command, { 
              shell: true,
              encoding: 'utf8', 
              maxBuffer: 10 * 1024 * 1024,
              timeout: 30000,
              windowsHide: true
            });
            
            ws.send(JSON.stringify({
              type: 'command_result',
              output: output,
              success: true,
              targetPeerId: currentClientPeerId
            }));
          } catch (err) {
            ws.send(JSON.stringify({
              type: 'command_result',
              output: err.stderr || err.message,
              success: false,
              targetPeerId: currentClientPeerId
            }));
          }
        }
      } catch (error) {
        log.error(`Error processing message: ${error.message}`);
      }
    });
  });
  
  ws.on('error', (error) => {
    clearInterval(pingInterval);
    log.error(`Connection failed: ${error.message}`);
    log.info(`Relay server: ${RELAY_SERVER}`);
    process.exit(1);
  });
  
  ws.on('close', (code, reason) => {
    clearInterval(pingInterval);
    console.log(`\n${colors.yellow}⚠${colors.reset} ${colors.dim}Disconnected from relay server${colors.reset}`);
    process.exit(0);
  });
  
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log(`\n${colors.yellow}⚠${colors.reset} Stopping host...`);
    clearInterval(pingInterval);
    if (ws.readyState === WebSocket.OPEN) {
      ws.close(1000, 'Host shutting down');
    }
    process.exit(0);
  });
}

// Connect to host
function connectToHost(sessionId, password) {
  const token = generateToken(password);
  
  console.log(`\n${colors.bgBlue}${colors.black}${colors.bright}                  CONNECTING TO HOST                  ${colors.reset}\n`);
  
  log.info(`Connecting to session: ${colors.bright}${sessionId}${colors.reset}`);
  
  const wsUrl = `${RELAY_SERVER.replace(/^http/, 'ws')}?session=${sessionId}&role=client&token=${token}`;
  const ws = new WebSocket(wsUrl);
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  let connected = false;
  let pingInterval;
  
  ws.on('open', () => {
    log.success('Connected to relay server');
    console.log(`${colors.dim}Waiting for host to accept connection...${colors.reset}\n`);
    
    // Keep connection alive
    pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, 30000);
    
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        if (message.type === 'metadata') {
          connected = true;
          clearInterval(pingInterval);
          
          const m = message.data;
          
          console.log(`\n${colors.bgGreen}${colors.black}${colors.bright}                  REMOTE SYSTEM INFO                   ${colors.reset}\n`);
          
          log.section('📋 System');
          console.log(`  ${colors.cyan}•${colors.reset} OS:        ${colors.white}${m.os.platform} ${m.os.release}${colors.reset} ${colors.dim}(${m.os.arch})${colors.reset}`);
          console.log(`  ${colors.cyan}•${colors.reset} Hostname:  ${colors.white}${m.os.hostname}${colors.reset}`);
          console.log(`  ${colors.cyan}•${colors.reset} Uptime:    ${colors.white}${Math.floor(m.os.uptime / 3600)}h ${Math.floor((m.os.uptime % 3600) / 60)}m${colors.reset}`);
          
          if (m.os.isWSL) {
            console.log(`  ${colors.cyan}•${colors.reset} WSL:       ${colors.yellow}v${m.os.wslVersion} - ${m.os.wslDistro}${colors.reset}`);
          }
          
          log.section('👤 User');
          console.log(`  ${colors.cyan}•${colors.reset} Username:  ${colors.white}${m.user.username}${colors.reset}`);
          console.log(`  ${colors.cyan}•${colors.reset} Shell:     ${colors.white}${m.user.shell}${colors.reset}`);
          console.log(`  ${colors.cyan}•${colors.reset} Home:      ${colors.dim}${m.user.homedir}${colors.reset}`);
          
          log.section('💻 Hardware');
          console.log(`  ${colors.cyan}•${colors.reset} CPU:       ${colors.white}${m.hardware.cpuModel}${colors.reset}`);
          console.log(`  ${colors.cyan}•${colors.reset} Cores:     ${colors.white}${m.hardware.cpus}${colors.reset}`);
          console.log(`  ${colors.cyan}•${colors.reset} Memory:    ${colors.white}${(m.hardware.totalMemory / 1024 / 1024 / 1024).toFixed(2)} GB${colors.reset}`);
          if (m.hardware.totalDisk) {
            console.log(`  ${colors.cyan}•${colors.reset} Disk:      ${colors.white}${m.hardware.totalDisk} total${colors.reset} ${colors.dim}(${m.hardware.freeDisk} free)${colors.reset}`);
          }
          
          log.section('🛠️  Software');
          console.log(`  ${colors.cyan}•${colors.reset} Node.js:   ${colors.green}${m.software.nodeVersion}${colors.reset}`);
          if (m.software.npmVersion) console.log(`  ${colors.cyan}•${colors.reset} npm:       ${colors.green}${m.software.npmVersion}${colors.reset}`);
          if (m.software.gitVersion) console.log(`  ${colors.cyan}•${colors.reset} Git:       ${colors.green}${m.software.gitVersion}${colors.reset}`);
          if (m.software.pythonVersion) console.log(`  ${colors.cyan}•${colors.reset} Python:    ${colors.green}${m.software.pythonVersion}${colors.reset}`);
          if (m.software.dockerVersion) console.log(`  ${colors.cyan}•${colors.reset} Docker:    ${colors.green}${m.software.dockerVersion}${colors.reset}`);
          
          if (m.environment.isDocker || m.environment.isSSH) {
            log.section('🏗️  Environment');
            if (m.environment.isDocker) console.log(`  ${colors.cyan}•${colors.reset} Running in Docker container`);
            if (m.environment.isSSH) console.log(`  ${colors.cyan}•${colors.reset} Via SSH connection`);
          }
          
          if (m.network.ipv4.length > 0) {
            log.section('🌐 Network');
            console.log(`  ${colors.cyan}•${colors.reset} IPv4: ${colors.dim}${m.network.ipv4.join(', ')}${colors.reset}`);
          }
          
          console.log(`\n${colors.bgCyan}${colors.black}${colors.bright}                                                    ${colors.reset}`);
          console.log(`${colors.bright}${colors.white}  Type commands to execute on remote host  ${colors.reset}`);
          console.log(`${colors.bright}${colors.white}  Type 'exit' to disconnect                ${colors.reset}`);
          console.log(`${colors.bgCyan}${colors.black}${colors.bright}                                                    ${colors.reset}\n`);
          
          promptCommand();
        }
        else if (message.type === 'command_result') {
          if (message.output) {
            console.log(message.output);
          }
          promptCommand();
        }
        else if (message.type === 'host_disconnected') {
          console.log(`\n${colors.yellow}⚠${colors.reset} ${colors.red}Host has disconnected${colors.reset}`);
          rl.close();
          ws.close();
          process.exit(0);
        }
      } catch (error) {
        log.error(`Error processing message: ${error.message}`);
      }
    });
  });
  
  function promptCommand() {
    rl.question(`${colors.bright}${colors.green}rcmd${colors.reset}${colors.dim}>${colors.reset} `, (input) => {
      if (input.toLowerCase() === 'exit') {
        console.log(`\n${colors.green}✓${colors.reset} Disconnected`);
        rl.close();
        clearInterval(pingInterval);
        if (ws.readyState === WebSocket.OPEN) {
          ws.close(1000, 'Client disconnected');
        }
        process.exit(0);
      }
      
      if (input.trim() && ws.readyState === WebSocket.OPEN && connected) {
        ws.send(JSON.stringify({
          type: 'client_command',
          command: input
        }));
      } else if (!connected) {
        log.warn('Not yet connected to host');
        promptCommand();
      } else {
        promptCommand();
      }
    });
  }
  
  ws.on('error', (error) => {
    clearInterval(pingInterval);
    log.error(`Connection failed: ${error.message}`);
    log.info('Make sure the host is running and the relay server is accessible');
    process.exit(1);
  });
  
  ws.on('close', (code) => {
    clearInterval(pingInterval);
    if (!connected) {
      console.log(`\n${colors.red}✗${colors.reset} Could not connect to host`);
      console.log(`${colors.dim}  Check:${colors.reset}`);
      console.log(`${colors.dim}  • Session ID is correct${colors.reset}`);
      console.log(`${colors.dim}  • Password is correct${colors.reset}`);
      console.log(`${colors.dim}  • Host is still running${colors.reset}`);
      console.log(`${colors.dim}  • Relay server is accessible${colors.reset}\n`);
    }
    process.exit(0);
  });
}