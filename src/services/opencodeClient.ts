import { ServerConfig, Session, MessageWithParts } from '../types';

export class OpencodeClient {
  private baseUrl: string;

  constructor(config: ServerConfig) {
    this.baseUrl = `http://${config.hostname}:${config.port}`;
  }

  async createSession(): Promise<{ id: string; code: string; password: string }> {
    const response = await fetch(`${this.baseUrl}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`Failed to create session: ${response.statusText}`);
    }
    return response.json();
  }

  async sendMessage(sessionId: string, text: string): Promise<MessageWithParts> {
    const response = await fetch(`${this.baseUrl}/session/${sessionId}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parts: [{ type: 'text', text }],
      }),
    });
    if (!response.ok) {
      throw new Error(`Failed to send message: ${response.statusText}`);
    }
    return response.json();
  }
}
