// src/api/gistManager.ts
import { GitHubGist, Snippet } from '../types';
import { storage } from '../utils/storage';
import { GITHUB_CONFIG } from './github.config';

export class GistManager {
  private readonly GITHUB_API = GITHUB_CONFIG.API_BASE;
  private readonly GIST_FILENAME = GITHUB_CONFIG.GIST_FILENAME;
  private readonly CLIENT_ID = GITHUB_CONFIG.CLIENT_ID;

  async authenticate(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.CLIENT_ID || this.CLIENT_ID === 'your_client_id_here') {
        reject(new Error('GitHub client ID is not configured. Update GITHUB_CLIENT_ID in your environment.'));
        return;
      }

      const authUrl = `https://github.com/login/oauth/authorize?client_id=${this.CLIENT_ID}&scope=gist`;
      
      chrome.identity.launchWebAuthFlow(
        {
          url: authUrl,
          interactive: true
        },
        (redirectUrl) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
            return;
          }
          
          // Extract token from redirect URL
          const url = new URL(redirectUrl || '');
          const code = url.searchParams.get('code');
          
          if (code) {
            // In a real implementation, exchange code for token via your backend
            resolve(code);
          } else {
            reject(new Error('Authentication failed'));
          }
        }
      );
    });
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