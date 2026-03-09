// src/common/env.ts
import dotenv from 'dotenv';
import path from 'path';

// Load .env file
const envPath = path.join(__dirname, '../../.env');
dotenv.config({ path: envPath });

export const ENV = {
  // Environment mode
  NODE_ENV: process.env.NODE_ENV || 'development',
  
  // Remote UI Configuration
  REMOTE_UI_URL: process.env.REMOTE_UI_URL || 'http://localhost:5173',
  REMOTE_UI_FALLBACK: process.env.REMOTE_UI_FALLBACK || 'https://fallback.yourdomain.com',
  
  // Security - Allowed domains
  ALLOWED_DOMAINS: process.env.ALLOWED_DOMAINS 
    ? process.env.ALLOWED_DOMAINS.split(',').map(d => d.trim())
    : [process.env.REMOTE_UI_URL || 'http://localhost:5173'],
  
  // Debug settings
  ENABLE_DEVTOOLS: process.env.NODE_ENV !== 'production' || process.env.ENABLE_DEVTOOLS === 'false',
  DEBUG_LOGS: process.env.NODE_ENV === 'development' || process.env.DEBUG_LOGS === 'false',
  
  // App settings
  APP_NAME: process.env.APP_NAME || 'SilentPrint',
  APP_VERSION: process.env.npm_package_version || '1.0.0',
  
  // Print settings
  DEFAULT_PRINTER: process.env.DEFAULT_PRINTER || '',
  PRINT_TIMEOUT: parseInt(process.env.PRINT_TIMEOUT || '60000', 10),
  
  // Development settings
  HMR_ENABLED: process.env.HMR_ENABLED === 'false',
  VITE_DEV_SERVER: process.env.VITE_DEV_SERVER || 'http://localhost:5173'
} as const;

// Type guard
export type Environment = typeof ENV;

// Validation
if (!ENV.REMOTE_UI_URL) {
  console.warn('[ENV] REMOTE_UI_URL not set, using default');
}

if (ENV.NODE_ENV === 'production' && !ENV.REMOTE_UI_URL.startsWith('https://')) {
  console.warn('[ENV] WARNING: Production should use HTTPS for REMOTE_UI_URL');
}

// Helper function for logging
export const logEnv = () => {
  if (ENV.DEBUG_LOGS) {
    console.log('='.repeat(50));
    console.log('ENVIRONMENT CONFIGURATION');
    console.log('='.repeat(50));
    console.log(`NODE_ENV: ${ENV.NODE_ENV}`);
    console.log(`REMOTE_UI_URL: ${ENV.REMOTE_UI_URL}`);
    console.log(`ENABLE_DEVTOOLS: ${ENV.ENABLE_DEVTOOLS}`);
    console.log(`DEBUG_LOGS: ${ENV.DEBUG_LOGS}`);
    console.log(`ALLOWED_DOMAINS: ${ENV.ALLOWED_DOMAINS.join(', ')}`);
    console.log('='.repeat(50));
  }
};

export default ENV;