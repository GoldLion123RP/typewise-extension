// src/api/gistManager.ts
import { GitHubGist, Snippet } from '../types';
import { storage } from '../utils/storage';
import { GITHUB_CONFIG } from './github.config';

export class GistManager {
  private readonly GITHUB_API = GITHUB_CONFIG.API_BASE;
  private readonly GIST_FILENAME = GITHUB_CONFIG.GIST_FILENAME;
  private readonly CLIENT_ID = GITHUB_CONFIG.CLIENT_ID;

  async authenticate(): Promise<string> {
    if (!this.CLIENT_ID || this.CLIENT_ID === 'your_client_id_here') {
      throw new Error('GitHub client ID is not configured. Update GITHUB_CLIENT_ID in your environment.');
    }

    const deviceCodeResponse = await fetch('https://github.com/login/device/code', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: this.CLIENT_ID,
        scope: 'gist',
      }).toString(),
    });

    if (!deviceCodeResponse.ok) {
      throw new Error(`GitHub device flow error: ${deviceCodeResponse.statusText}`);
    }

    const deviceCodeData = await deviceCodeResponse.json() as {
      device_code: string;
      user_code: string;
      verification_uri: string;
      verification_uri_complete?: string;
      expires_in: number;
      interval?: number;
    };

    if (!deviceCodeData.device_code || !deviceCodeData.verification_uri) {
      throw new Error('GitHub device authorization did not return a valid verification URL.');
    }

    const authWindowUrl = deviceCodeData.verification_uri_complete || deviceCodeData.verification_uri;
    window.open(authWindowUrl, '_blank', 'noopener,noreferrer');

    const pollInterval = Math.max(deviceCodeData.interval || 5, 5) * 1000;
    const expirationAt = Date.now() + deviceCodeData.expires_in * 1000;

    while (Date.now() < expirationAt) {
      const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: this.CLIENT_ID,
          device_code: deviceCodeData.device_code,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }).toString(),
      });

      if (!tokenResponse.ok) {
        throw new Error(`GitHub token polling error: ${tokenResponse.statusText}`);
      }

      const tokenData = await tokenResponse.json() as {
        access_token?: string;
        error?: string;
        error_description?: string;
      };

      if (tokenData.access_token) {
        return tokenData.access_token;
      }

      if (tokenData.error === 'authorization_pending') {
        await new Promise((resolve) => window.setTimeout(resolve, pollInterval));
        continue;
      }

      if (tokenData.error === 'slow_down') {
        await new Promise((resolve) => window.setTimeout(resolve, pollInterval + 5000));
        continue;
      }

      if (tokenData.error) {
        throw new Error(tokenData.error_description || `GitHub authentication failed: ${tokenData.error}`);
      }

      await new Promise((resolve) => window.setTimeout(resolve, pollInterval));
    }

    throw new Error('GitHub device authorization expired before it was approved.');
  }

  async fetchGitHubUsername(token: string): Promise<string> {
    const response = await fetch(`${this.GITHUB_API}/user`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to verify GitHub account: ${response.statusText}`);
    }

    const user = await response.json() as { login?: string };
    if (!user.login) {
      throw new Error('GitHub account verification did not return a username.');
    }

    return user.login;
  }

  async createOrUpdateGist(token: string, snippets: Snippet[]): Promise<string> {
    const user = await storage.getUser();
    const gistId = user.gistId;

    const gistData = {
      description: 'TypeWise Snippets - Last updated: ' + new Date().toISOString(),
      public: false,
      files: {
        [this.GIST_FILENAME]: {
          content: JSON.stringify(snippets, null, 2)
        }
      }
    };

    const url = gistId 
      ? `${this.GITHUB_API}/gists/${gistId}`
      : `${this.GITHUB_API}/gists`;
    
    const method = gistId ? 'PATCH' : 'POST';

    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(gistData)
      });

      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.statusText}`);
      }

      const gist: GitHubGist = await response.json();
      
      // Save gist ID for future updates
      if (!gistId) {
        await storage.updateUser({ gistId: gist.id });
      }
      
      return gist.id;
    } catch (error) {
      console.error('Error creating/updating gist:', error);
      throw error;
    }
  }

  async fetchGist(token: string, gistId: string): Promise<Snippet[]> {
    try {
      const response = await fetch(`${this.GITHUB_API}/gists/${gistId}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch gist: ${response.statusText}`);
      }

      const gist: GitHubGist = await response.json();
      const content = gist.files[this.GIST_FILENAME]?.content;
      
      if (content) {
        return JSON.parse(content);
      }
      
      return [];
    } catch (error) {
      console.error('Error fetching gist:', error);
      throw error;
    }
  }

  async syncWithGist(): Promise<void> {
    const user = await storage.getUser();
    
    if (!user.githubToken) {
      throw new Error('Not authenticated with GitHub');
    }

    const snippets = await storage.getSnippets();
    await this.createOrUpdateGist(user.githubToken, snippets);
    
    // Update last sync time
    const data = await storage.getAll();
    data.lastSync = new Date().toISOString();
    await storage.saveAll(data);
  }

  async pullFromGist(): Promise<void> {
    const user = await storage.getUser();
    
    if (!user.githubToken || !user.gistId) {
      throw new Error('Not connected to GitHub Gist');
    }

    const snippets = await this.fetchGist(user.githubToken, user.gistId);
    const data = await storage.getAll();
    data.snippets = snippets;
    data.lastSync = new Date().toISOString();
    await storage.saveAll(data);
  }
}

export const gistManager = new GistManager();