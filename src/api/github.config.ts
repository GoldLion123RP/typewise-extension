// GitHub Gist API Configuration
const envClientId = typeof process !== 'undefined' ? process.env.GITHUB_CLIENT_ID : undefined;

export const GITHUB_CONFIG = {
  CLIENT_ID: (envClientId || 'your_client_id_here').trim(),
  GIST_FILENAME: 'typewise-snippets.json',
  GIST_DESCRIPTION: 'TypeWise Extension - Snippet Storage',
  API_BASE: 'https://api.github.com',
  OAUTH_URL: 'https://github.com/login/oauth/authorize',
  SCOPES: 'gist'
};
