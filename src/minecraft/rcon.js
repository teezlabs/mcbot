import { Rcon } from 'rcon-client';

export class RconClient {
  constructor({ host, port, password }) {
    this.config = { host, port: Number(port), password };
    this.rcon = null;
    this.reconnectTimer = null;
  }

  async connect() {
    try {
      this.rcon = await Rcon.connect(this.config);
      console.log('[RCON] Connected');
      this.rcon.on('error', (err) => {
        console.error('[RCON] Error:', err.message);
        this._scheduleReconnect();
      });
      this.rcon.socket.on('close', () => {
        console.warn('[RCON] Connection closed, reconnecting...');
        this._scheduleReconnect();
      });
    } catch (err) {
      console.error('[RCON] Failed to connect:', err.message);
      console.warn('[RCON] Retrying in 10s... (is the server running and RCON enabled?)');
      this._scheduleReconnect();
    }
  }

  async send(command) {
    if (!this.rcon) return;
    try {
      await this.rcon.send(command);
    } catch (err) {
      console.error('[RCON] Send failed:', err.message);
    }
  }

  async query(command) {
    if (!this.rcon) return null;
    try {
      return await this.rcon.send(command);
    } catch (err) {
      console.error('[RCON] Query failed:', err.message);
      return null;
    }
  }

  get connected() {
    return this.rcon !== null;
  }

  _scheduleReconnect() {
    this.rcon = null;
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      await this.connect();
    }, 10_000);
  }
}
