import { Rcon } from 'rcon-client';

export class RconClient {
  constructor({ host, port, password }) {
    this.config = { host, port: Number(port), password };
    this.rcon = null;
    this.reconnectTimer = null;
  }

  async connect() {
    // Listeners go on before connect(): rcon-client emits socket errors as soon as the TCP connection
    // is up, and a reset during auth (Docker's port proxy does this while the server starts) would
    // otherwise be an unhandled 'error' event that crashes the bot
    const rcon = new Rcon(this.config);
    rcon.on('error', (err) => {
      if (this.rcon !== rcon) return;
      console.error('[RCON] Error:', err.message);
      this._scheduleReconnect();
    });
    rcon.on('end', () => {
      if (this.rcon !== rcon) return;
      console.warn('[RCON] Connection closed, reconnecting...');
      this._scheduleReconnect();
    });
    try {
      await rcon.connect();
      this.rcon = rcon;
      console.log('[RCON] Connected');
    } catch (err) {
      rcon.socket?.destroy();
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
