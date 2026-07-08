#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { execSync, spawn } = require('child_process');
const crypto = require('crypto');
const os = require('os');
const readline = require('readline');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const CONFIG_DIR = path.join(os.homedir(), '.rcmd');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const RELAY_SERVER = process.env.RCMD_RELAY || 'https://rcmd-relay.onrender.com';

// Ensure config directory exists
if (!fs.existsSync(CONFIG_DIR)) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

// Command handler
const command = process.argv[2];
const args = process.argv.slice(3);

if (command === 'host' || command === 'h') {
  // Start hosting mode
  const password = args[0];
  const port = args[1] || '5555';
  
  if (!password) {
    console.error('✗ Password required for hosting');
    console.log('Usage: rcmd host <password> [port]');
    process.exit(1);
  }
  
  startHosting(password, port);
} 
else if (command === 'connect' || command === 'c') {
  // Connect to a host
  const sessionId = args[0];
  const password = args[1];
  
  if (!sessionId || !password) {
    console.error('✗ Session ID and password required');
    console.log('Usage: rcmd connect <session-id> <password>');
    process.exit(1);
  }
  
  connectToHost(sessionId, password);
} 
else {
  displayHelp();
}

// Display help
function displayHelp() {
  console.log(`
╔══════════════════════════════════════════════╗
║      RCMD - Remote Terminal Access v1.0      ║
╚══════════════════════════════════════════════╝

Commands:
  rcmd host <password> [port]        Start hosting your terminal
  rcmd connect <session-id> <password>  Connect to a remote terminal

Examples:
  rcmd host mysecretpass
  rcmd connect abc123 mysecretpass

Relay Server: ${RELAY_SERVER}
`);
  process.exit(0);
}

// Get detailed system metadata (Windows compatible)
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
      interfaces: [],
    },
    environment: {
      isDocker: false,
      isSSH: !!process.env.SSH_TTY,
      isScreen: !!process.env.STY,
      isTmux: !!process.env.TMUX,
      terminal: process.env.TERM || 'unknown',
      lang: process.env.LANG || 'unknown',
    },
    timestamp: new Date().toISOString(),
  };

  // Windows-specific commands
  const isWindows = os.platform() === 'win32';
  
  try {
    if (isWindows) {
      // Check for WSL
      try {
        const wslCheck = execSync('wsl --status 2>nul', { encoding: 'utf8' });
        metadata.os.isWSL = false; // Windows itself, not WSL
      } catch {
        // WSL not installed, that's fine
      }
      
      // Get disk space on Windows
      try {
        const diskInfo = execSync('wmic logicaldisk where "DeviceID=\'C:\'" get Size,FreeSpace /format:csv', { encoding: 'utf8' });
        const lines = diskInfo.trim().split('\n');
        if (lines.length >= 2) {
          const values = lines[1].split(',');
          if (values.length >= 3) {
            metadata.hardware.freeDisk = (parseInt(values[1]) / (1024*1024*1024)).toFixed(2) + ' GB';
            metadata.hardware.totalDisk = (parseInt(values[2]) / (1024*1024*1024)).toFixed(2) + ' GB';
          }
        }
      } catch {}
      
      // Windows-specific tool checks
      try {
        metadata.software.npmVersion = execSync('npm --version 2>nul', { encoding: 'utf8' }).trim();
      } catch {}
      
      try {
        metadata.software.gitVersion = execSync('git --version 2>nul', { encoding: 'utf8' }).trim();
      } catch {}
      
      try {
        metadata.software.pythonVersion = execSync('python --version 2>nul', { encoding: 'utf8' }).trim();
      } catch {}
      
      try {
        metadata.software.dockerVersion = execSync('docker --version 2>nul', { encoding: 'utf8' }).trim();
      } catch {}
    }
  } catch (error) {
    // Silently handle errors for optional features
  }

  // Get network interfaces
  try {
    const interfaces = os.networkInterfaces();
    for (const [name, netInfo] of Object.entries(interfaces)) {
      netInfo.forEach(addr => {
        if (addr.family === 'IPv4') {
          metadata.network.ipv4.push(`${addr.address} (${name})`);
        } else if (addr.family === 'IPv6') {
          metadata.network.ipv6.push(`${addr.address} (${name})`);
        }
      });
    }
  } catch {}

  return metadata;
}
// Start hosting terminal
function startHosting(password, port) {
  const sessionId = generateSessionId(password);
  const token = generateToken(password);
  
  console.log(`\n╔════════════════════════════════════════╗`);
  console.log(`║          HOSTING TERMINAL              ║`);
  console.log(`╚════════════════════════════════════════╝\n`);
  
  console.log(`✓ Session ID: ${sessionId}`);
  console.log(`✓ Password: ${password}`);
  console.log(`\n✓ Share this command to connect:`);
  console.log(`  rcmd connect ${sessionId} ${password}\n`);
  
  // Collect metadata
  const metadata = getSystemMetadata();
  console.log(`✓ System Information:`);
  console.log(`  • OS: ${metadata.os.platform} ${metadata.os.release}`);
  console.log(`  • Hostname: ${metadata.os.hostname}`);
  console.log(`  • User: ${metadata.user.username}`);
  console.log(`  • CPUs: ${metadata.hardware.cpus}`);
  console.log(`  • Memory: ${(metadata.hardware.totalMemory / 1024 / 1024 / 1024).toFixed(2)} GB`);
  if (metadata.os.isWSL) {
    console.log(`  • WSL ${metadata.os.wslVersion}: ${metadata.os.wslDistro}`);
  }
  console.log(`\n✓ Connecting to relay server...`);
  
  // Connect to relay via WebSocket
  const ws = new WebSocket(`${RELAY_SERVER.replace(/^http/, 'ws')}?session=${sessionId}&role=host&token=${token}`);
  
  let currentClientPeerId = null;
  
  ws.on('open', () => {
    console.log(`✓ Connected to relay server`);
    console.log(`✓ Waiting for clients...\n`);
    
    // Send metadata when requested
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        if (message.type === 'request_metadata') {
          ws.send(JSON.stringify({
            type: 'metadata_response',
            data: metadata
          }));
        }
        else if (message.type === 'client_command') {
          // Execute command from client
          currentClientPeerId = message.fromPeerId;
          const command = message.command;
          
          console.log(`\n> ${command}`);
          
          try {
            const shell = os.platform() === 'win32' ? 'cmd.exe' : '/bin/bash';
            const shellArg = os.platform() === 'win32' ? '/c' : '-c';
            
            const output = execSync(command, { 
              shell: `${shell} ${shellArg} "${command}"`,
              encoding: 'utf8', 
              maxBuffer: 10 * 1024 * 1024,
              timeout: 30000
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
              output: err.message,
              success: false,
              targetPeerId: currentClientPeerId
            }));
          }
        }
      } catch (error) {
        console.error('Error processing message:', error.message);
      }
    });
  });
  
  ws.on('error', (error) => {
    console.error(`✗ Connection error: ${error.message}`);
  });
  
  ws.on('close', () => {
    console.log(`\n✓ Disconnected from relay server`);
    process.exit(0);
  });
  
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log(`\n✓ Stopping host...`);
    ws.close();
    process.exit(0);
  });
}

// Connect to host
function connectToHost(sessionId, password) {
  const token = generateToken(password);
  
  console.log(`\n╔════════════════════════════════════════╗`);
  console.log(`║         CONNECTING TO HOST             ║`);
  console.log(`╚════════════════════════════════════════╝\n`);
  
  console.log(`✓ Connecting to session: ${sessionId}`);
  
  const ws = new WebSocket(`${RELAY_SERVER.replace(/^http/, 'ws')}?session=${sessionId}&role=client&token=${token}`);
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  let connected = false;
  
  ws.on('open', () => {
    console.log(`✓ Connected to relay server`);
    console.log(`✓ Waiting for host...\n`);
    
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        if (message.type === 'metadata') {
          connected = true;
          console.log(`✓ Host connected!`);
          console.log(`\n╔════════════════════════════════════════╗`);
          console.log(`║         REMOTE SYSTEM INFO             ║`);
          console.log(`╚════════════════════════════════════════╝`);
          
          const m = message.data;
          console.log(`\n📋 System:`);
          console.log(`  • OS: ${m.os.platform} ${m.os.release} (${m.os.arch})`);
          console.log(`  • Hostname: ${m.os.hostname}`);
          console.log(`  • Uptime: ${Math.floor(m.os.uptime / 3600)}h ${Math.floor((m.os.uptime % 3600) / 60)}m`);
          
          if (m.os.isWSL) {
            console.log(`  • WSL: v${m.os.wslVersion} - ${m.os.wslDistro}`);
          }
          
          console.log(`\n👤 User:`);
          console.log(`  • Username: ${m.user.username}`);
          console.log(`  • Shell: ${m.user.shell}`);
          console.log(`  • Home: ${m.user.homedir}`);
          
          console.log(`\n💻 Hardware:`);
          console.log(`  • CPU: ${m.hardware.cpuModel}`);
          console.log(`  • Cores: ${m.hardware.cpus}`);
          console.log(`  • Memory: ${(m.hardware.totalMemory / 1024 / 1024 / 1024).toFixed(2)} GB`);
          if (m.hardware.totalDisk) {
            console.log(`  • Disk: ${m.hardware.totalDisk} total, ${m.hardware.freeDisk} free`);
          }
          
          console.log(`\n🛠️ Tools:`);
          console.log(`  • Node.js: ${m.software.nodeVersion}`);
          if (m.software.gitVersion) console.log(`  • Git: ${m.software.gitVersion}`);
          if (m.software.pythonVersion) console.log(`  • Python: ${m.software.pythonVersion}`);
          if (m.software.dockerVersion) console.log(`  • Docker: ${m.software.dockerVersion}`);
          
          if (m.environment.isDocker) console.log(`  • Running in Docker container`);
          if (m.environment.isSSH) console.log(`  • Via SSH connection`);
          
          console.log(`\n🌐 Network:`);
          console.log(`  • IPv4: ${m.network.ipv4.join(', ') || 'None'}`);
          
          console.log(`\n${'═'.repeat(44)}`);
          console.log(`Type commands to execute on remote host`);
          console.log(`Type 'exit' to disconnect\n`);
          
          promptCommand();
        }
        else if (message.type === 'command_result') {
          if (message.output) {
            console.log(message.output);
          }
          promptCommand();
        }
        else if (message.type === 'host_disconnected') {
          console.log(`\n✗ Host disconnected`);
          rl.close();
          process.exit(0);
        }
      } catch (error) {
        console.error('Error processing message:', error.message);
      }
    });
  });
  
  function promptCommand() {
    rl.question('rcmd> ', (input) => {
      if (input.toLowerCase() === 'exit') {
        console.log(`✓ Disconnected`);
        rl.close();
        ws.close();
        process.exit(0);
      }
      
      if (input.trim() && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'client_command',
          command: input
        }));
      } else {
        promptCommand();
      }
    });
  }
  
  ws.on('error', (error) => {
    console.error(`✗ Connection error: ${error.message}`);
    process.exit(1);
  });
  
  ws.on('close', () => {
    if (!connected) {
      console.log(`✗ Could not connect to host. Check session ID and password.`);
    }
    process.exit(0);
  });
}

// Utility functions
function generateSessionId(password) {
  return crypto.createHash('sha256')
    .update(password + 'session')
    .digest('hex')
    .substring(0, 8);
}

function generateToken(password) {
  return crypto.createHash('sha256')
    .update(password + Date.now().toString())
    .digest('hex')
    .substring(0, 16);
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}