/**
 * High-level facade tying together the connection and all service classes.
 *
 * UI code interacts with a single PokitDevice instance rather than juggling
 * individual service objects.
 */

import { PokitConnection } from "./connection";
import { StatusService } from "./statusService";
import { MultimeterService } from "./multimeterService";
import { DsoService } from "./dsoService";
import { LoggerService } from "./loggerService";

export class PokitDevice {
  readonly connection = new PokitConnection();

  private _status: StatusService | null = null;
  private _multimeter: MultimeterService | null = null;
  private _dso: DsoService | null = null;
  private _logger: LoggerService | null = null;

  static isSupported(): boolean {
    return PokitConnection.isAvailable();
  }

  get isConnected(): boolean {
    return this.connection.isConnected;
  }

  get name(): string {
    return this.connection.deviceName;
  }

  /** Service accessors (lazily constructed after connection). */
  get status(): StatusService {
    return (this._status ??= new StatusService(this.connection));
  }

  get multimeter(): MultimeterService {
    return (this._multimeter ??= new MultimeterService(this.connection));
  }

  get dso(): DsoService {
    return (this._dso ??= new DsoService(this.connection));
  }

  get logger(): LoggerService {
    return (this._logger ??= new LoggerService(this.connection));
  }

  async connect(): Promise<void> {
    await this.connection.requestAndConnect();
    // Reset cached services so they bind to the (possibly re-detected) product.
    this._status = null;
    this._multimeter = null;
    this._dso = null;
    this._logger = null;
  }

  disconnect(): void {
    this.connection.disconnect();
  }
}
