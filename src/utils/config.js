const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '../../config/config.json');

function loadConfig() {
  try {
    const configData = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(configData);
  } catch (error) {
    console.error('Error loading config:', error);
    process.exit(1);
  }
}

function saveConfig(config) {
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Error saving config:', error);
    return false;
  }
}

module.exports = { loadConfig, saveConfig };