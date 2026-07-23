import { PublicClientApplication } from '@azure/msal-browser';

export const msalConfig = {
  auth: {
    clientId: import.meta.env.VITE_AZURE_CLIENT_ID,
    authority: `https://login.microsoftonline.com/${import.meta.env.VITE_AZURE_TENANT_ID}`,
    redirectUri: window.location.origin + (import.meta.env.BASE_URL || '/'),
  },
  cache: {
    cacheLocation: 'sessionStorage',
    storeAuthStateInCookie: false,
  },
  system: {
    navigateToLoginRequestUrl: false,
  },
};

// Basic profile only — PSRI CRM doesn't need mail access
export const loginRequest = {
  scopes: ['openid', 'profile', 'email', 'User.Read'],
};

export const msalInstance = new PublicClientApplication(msalConfig);
