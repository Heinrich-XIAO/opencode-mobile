import { ServerConfig, HealthResponse, Session, MessageWithParts } from '../types';

export class OpencodeClient {
  private baseUrl: string;
  private username?: string;
  private password?: string;

  constructor(config: ServerConfig) {
    this.baseUrl = `http://${config.hostname}:${config.port}`;
    this.username = config.username;
    this.password = config.password;
  }

  private getHeaders(): HeadersInit {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };
    if (this.username && this.password) {
      const credentials = btoa(`${this.username}:${this.password}`);
      headers['Authorization'] = `Basic ${credentials}`;
    }
    return headers;
  }

  async checkHealth(): Promise<HealthResponse> {
    const response = await fetch(`${this.baseUrl}/global/health`, {
      headers: this.getHeaders(),
    });
    if (!response.ok) {
      throw new Error(`Health check failed: ${response.statusText}`);
    }
    return response.json();
  }

  async listSessions(): Promise<Session[]> {
    const response = await fetch(`${this.baseUrl}/session`, {
      headers: this.getHeaders(),
    });
    if (!response.ok) {
      throw new Error(`Failed to list sessions: ${response.statusText}`);
    }
    return response.json();
  }

  async createSession(title?: string): Promise<Session> {
    const response = await fetch(`${this.baseUrl}/session`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(title ? { title } : {}),
    });
    if (!response.ok) {
      throw new Error(`Failed to create session: ${response.statusText}`);
    }
    return response.json();
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    const response = await fetch(`${this.baseUrl}/session/${sessionId}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    return response.ok;
  }

  async getSession(sessionId: string): Promise<Session> {
    const response = await fetch(`${this.baseUrl}/session/${sessionId}`, {
      headers: this.getHeaders(),
    });
    if (!response.ok) {
      throw new Error(`Failed to get session: ${response.statusText}`);
    }
    return response.json();
  }

  async getMessages(sessionId: string): Promise<MessageWithParts[]> {
    const response = await fetch(`${this.baseUrl}/session/${sessionId}/message`, {
      headers: this.getHeaders(),
    });
    if (!response.ok) {
      throw new Error(`Failed to get messages: ${response.statusText}`);
    }
    return response.json();
  }

  async sendMessage(sessionId: string, text: string): Promise<MessageWithParts> {
    const response = await fetch(`${this.baseUrl}/session/${sessionId}/message`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        parts: [{ type: 'text', text }],
      }),
    });
    if (!response.ok) {
      throw new Error(`Failed to send message: ${response.statusText}`);
    }
    return response.json();
  }

  async abortSession(sessionId: string): Promise<boolean> {
    const response = await fetch(`${this.baseUrl}/session/${sessionId}/abort`, {
      method: 'POST',
      headers: this.getHeaders(),
    });
    return response.ok;
  }
}
