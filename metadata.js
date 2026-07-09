const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');

/**
 * Get detailed system metadata
 * @returns {Object} System metadata object
 */
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
      collectWindowsMetadata(metadata);
    } else {
      collectLinuxMetadata(metadata);
    }
  } catch (error) {
    // Silently handle metadata collection errors
  }

  // Collect network information (cross-platform)
  collectNetworkInfo(metadata);

  return metadata;
}

/**
 * Collect Windows-specific metadata
 */
function collectWindowsMetadata(metadata) {
  try {
    // Disk space
    const diskInfo = execSync('wmic logicaldisk where "DeviceID=\'C:\'" get Size,FreeSpace /format:csv 2>nul', { 
      encoding: 'utf8',
      windowsHide: true 
    });
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
  try { metadata.software.npmVersion = execSync('npm --version 2>nul', { encoding: 'utf8', windowsHide: true }).trim(); } catch {}
  try { metadata.software.gitVersion = execSync('git --version 2>nul', { encoding: 'utf8', windowsHide: true }).trim(); } catch {}
  try { metadata.software.pythonVersion = execSync('python --version 2>nul', { encoding: 'utf8', windowsHide: true }).trim(); } catch {}
  try { metadata.software.dockerVersion = execSync('docker --version 2>nul', { encoding: 'utf8', windowsHide: true }).trim(); } catch {}
}

/**
 * Collect Linux/Mac-specific metadata
 */
function collectLinuxMetadata(metadata) {
  // WSL Detection
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

  // Disk space
  try {
    const diskInfo = execSync('df -h / 2>/dev/null | tail -1', { encoding: 'utf8' }).trim().split(/\s+/);
    if (diskInfo.length >= 4) {
      metadata.hardware.totalDisk = diskInfo[1];
      metadata.hardware.freeDisk = diskInfo[3];
    }
  } catch {}

  // Tool versions
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

/**
 * Collect network interface information
 */
function collectNetworkInfo(metadata) {
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
}

module.exports = {
  getSystemMetadata
};