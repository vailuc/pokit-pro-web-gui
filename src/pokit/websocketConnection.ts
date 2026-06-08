/**
 * WebSocket-based Pokit connection for high-performance BLE communication
 * 
 * This class provides an alternative to Web Bluetooth that bypasses platform
 * limitations by using a Python server with native BLE access.
 */

export type WebSocketDevice = {
  name: string;
  address: string;
  connected: boolean;
};

export type WebSocketMessage = {
  type: string;
  data?: any;
  params?: any;
};

export class WebSocketPokitConnection {
  private ws: WebSocket | null = null;
  private device: WebSocketDevice | null = null;
  private readonly messageHandlers = new Map<string, Function[]>();
  private connectionListeners = new Set<(connected: boolean) => void>();

  constructor(private readonly url: string = 'ws://localhost:8765') {}

  static isAvailable(): boolean {
    return typeof WebSocket !== 'undefined';
  }

  async requestAndConnect(): Promise<void> {
    if (!WebSocketPokitConnection.isAvailable()) {
      throw new Error('WebSocket not available in this environment');
    }

    // First, scan for devices
    const devices = await this.scan();
    if (devices.length === 0) {
      throw new Error('No Pokit devices found');
    }

    // Connect to first device
    await this.connect(devices[0].address);
  }

  async scan(): Promise<WebSocketDevice[]> {
    await this.ensureConnected();
    
    return new Promise((resolve, reject) => {
      if (!this.ws) {
        reject(new Error('WebSocket not connected'));
        return;
      }

      const messageHandler = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'device_found') {
            this.ws?.removeEventListener('message', messageHandler);
            resolve([{
              name: data.name,
              address: data.address,
              connected: false
            }]);
          }
        } catch (e) {
          reject(e);
        }
      };

      this.ws.addEventListener('message', messageHandler);
      this.ws.send(JSON.stringify({ type: 'scan' }));

      // Timeout after 5 seconds
      setTimeout(() => {
        this.ws?.removeEventListener('message', messageHandler);
        resolve([]);
      }, 5000);
    });
  }

  async connect(address: string): Promise<void> {
    await this.ensureConnected();
    
    return new Promise((resolve, reject) => {
      if (!this.ws) {
        reject(new Error('WebSocket not connected'));
        return;
      }

      const messageHandler = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'connected') {
            this.ws?.removeEventListener('message', messageHandler);
            this.device = {
              name: 'Pokit Pro',
              address,
              connected: true
            };
            this.emit(true);
            resolve();
          } else if (data.type === 'error') {
            this.ws?.removeEventListener('message', messageHandler);
            reject(new Error(data.error));
          }
        } catch (e) {
          reject(e);
        }
      };

      this.ws.addEventListener('message', messageHandler);
      this.ws.send(JSON.stringify({ 
        type: 'connect',
        address 
      }));

      // Timeout after 5 seconds
      setTimeout(() => {
        this.ws?.removeEventListener('message', messageHandler);
        reject(new Error('Connection timeout'));
      }, 5000);
    });
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.device = null;
    this.emit(false);
  }

  onConnectionChange(listener: (connected: boolean) => void): () => void {
    this.connectionListeners.add(listener);
    return () => this.connectionListeners.delete(listener);
  }

  private emit(connected: boolean): void {
    for (const listener of this.connectionListeners) {
      listener(connected);
    }
  }

  private async ensureConnected(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      
      this.ws.onopen = () => {
        console.log('WebSocket connected to Pokit server');
        resolve();
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        reject(error);
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleMessage(data);
        } catch (e) {
          console.error('Failed to parse WebSocket message:', e);
        }
      };

      this.ws.onclose = () => {
        console.log('WebSocket disconnected');
        this.emit(false);
      };
    });
  }

  private handleMessage(data: any): void {
    const handlers = this.messageHandlers.get(data.type) || [];
    for (const handler of handlers) {
      try {
        handler(data);
      } catch (e) {
        console.error('Error in message handler:', e);
      }
    }
  }

  // Method to register for specific message types
  onMessage(type: string, handler: Function): () => void {
    if (!this.messageHandlers.has(type)) {
      this.messageHandlers.set(type, []);
    }
    this.messageHandlers.get(type)!.push(handler);
    
    return () => {
      const handlers = this.messageHandlers.get(type);
      if (handlers) {
        const index = handlers.indexOf(handler);
        if (index > -1) {
          handlers.splice(index, 1);
        }
      }
    };
  }

  // Send command to server
  async sendCommand(type: string, params?: any): Promise<void> {
    await this.ensureConnected();
    
    if (this.ws) {
      this.ws.send(JSON.stringify({ type, params }));
    }
  }

  // Getters for compatibility with existing PokitConnection interface
  get isConnected(): boolean {
    return this.device?.connected ?? false;
  }

  get deviceName(): string {
    return this.device?.name ?? 'Unknown';
  }
}
