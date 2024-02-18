import * as _cluster from 'cluster';
import {
  ClusterfyCommandRequest,
  ClusterfyCommandRequestResult,
  ClusterfyPrimaryOptions,
  ClusterfyShutdownOptions
} from './types';
import * as process from 'process';
import { ClusterfyConnection } from './connections/connection';
import { ClusterfyWorkerConnection } from './connections/worker/worker-connection';
import { ClusterfyStorage } from './clusterfy-storage';
import { ClusterfyCommand } from './commands';

const cluster = _cluster as unknown as _cluster.Cluster;

export class PrimaryCommands {
  cy_storage_retrieve = new ClusterfyCommand('primary', async (
    { path, value }: { path: string; value: any },
    commandEvent?: ClusterfyCommandRequest<any>
  ) => {
    if (cluster.isPrimary) {
      const data = Clusterfy.storage.retrieve(path);
      const result = {
        status: 'success',
        data
      } as ClusterfyCommandRequestResult<any>;

      return result;
    } else {
      throw Error(`Command cy_storage_retrieve must be called on primary!`);
    }
  });


  cy_storage_save = new ClusterfyCommand('primary', async (
    { path, value }: { path: string; value: any },
    commandEvent?: ClusterfyCommandRequest<any>
  ) => {
    if (Clusterfy.isPrimary) {
      Clusterfy.storage.save(path, value);
      const result = {
        status: 'success',
        data: undefined
      } as ClusterfyCommandRequestResult<any>;

      return result;
    } else {
      throw Error(`Command cy_storage_save must be called on primary!`);
    }
  });
}

export class Clusterfy {
  private static _isPrimary = false;
  private static _storage: ClusterfyStorage<unknown>;
  private static _options?: ClusterfyPrimaryOptions;
  private static _connections: ClusterfyConnection[] = [];
  private static _shutdownRunning = false;
  private static _commands = new PrimaryCommands();
  private static _shutdownCommands: {
    command: (signal?: NodeJS.Signals) => Promise<void>;
    name: string;
  }[] = [];

  static get isPrimary(): boolean {
    return this._isPrimary;
  }

  /**
   * Returns shared storage (only on primary). Returns undefined else.
   */
  static get storage(): ClusterfyStorage<unknown> {
    return this._storage;
  }

  /**
   * Initializes the storage. Call this method on primary. The storage must be an object, e.g.
   * @param storage
   */
  static initStorage<T>(storage: ClusterfyStorage<T>) {
    Clusterfy._storage = storage;
  }

  static get options(): ClusterfyPrimaryOptions {
    return this._options;
  }

  static async connect<T extends ClusterfyConnection>(options: any): Promise<T> {
    if (options.ipc?.message?.enabled) {
      if (this._connections.find(a => a.type === 'message')) {
        throw new Error(`A connection of type "message" already exists.`);
      }
      const connection = new ClusterfyWorkerConnection(options.ipc, this._commands as any);
      await connection.connect();
      this._connections.push(connection);
      return connection as any;
    }
    throw new Error('Missing options');
  }

  /**
   * Initializes the primary with Clusterfy. This method must be called on primary (see example). If you want to include
   * graceful shutdown on process signals you need to add `shutdownOptions`.
   * @param options
   */
  static async initAsPrimary(options?: ClusterfyPrimaryOptions) {
    if (!cluster.isPrimary) {
      throw new Error(
        `Can't initialize clusterfy as primary. Current process is worker process.`
      );
    }

    this._isPrimary = true;
    this._options = options;

    if (options?.ipc?.socket?.enabled) {
      /** TODO move to socket connection
       console.log('!!! CREATE SOCKET SERVER');
       this._socketServer = createServer(
       options.ipc.socket,
       this.onSocketServerInit
       );

       if (os.type().includes('Windows')) {
       // listen on windows pipe
       } else {
       // listen on Unix socket
       this._socketServer.listen('/tmp/echo11.sock', () => {
       console.log('!!!! PRIMARY SOCKET SERVER BOUND');
       });
       }
       **/
    }

    process.on('SIGINT', Clusterfy.destroyPrimary);
    process.on('exit', Clusterfy.destroyPrimary);

    Clusterfy.initPrimaryShutdownRoutine(options?.shutdown);

    const promises = [];
    /** TODO need event from connection like "initiated"
     for (const worker of this._workers) {
     promises.push(
     this.waitForStatus(worker, [
     ClusterfyWorkerStatus.IDLE,
     ClusterfyWorkerStatus.PROCESSING,
     ])
     );
     }
     **/

    return Promise.all(promises);
  }


  /**
   * Saves a serializable value to a path in the shared storage on primary. Path should be a string with dot notation to the
   * attribute , e.g. "test.something". This method returns as soon as saved.
   * @param path
   * @param value
   */
  static async saveToStorage(path: string, value: any): Promise<void> {
    const connection: ClusterfyWorkerConnection = this._connections.find(a => a.type === 'message') as ClusterfyWorkerConnection;

    if (connection) {
      return connection.runIPCCommand<void>('cy_storage_save', {
        path,
        value
      });
    }
    throw new Error(`Can't save to storage: Missing connection of type message`);
  }


  /**
   * Returns a serializable value from a given path in shared storage. Path should be a string with dot notation to the
   * attribute , e.g. "test.something". This method returns the value of type `T` as soon as retrieved.
   * @param path
   */
  static async retrieveFromStorage<T>(path: string): Promise<T> {
    const connection: ClusterfyWorkerConnection = this._connections.find(a => a.type === 'message') as ClusterfyWorkerConnection;

    if (connection) {
      return connection.runIPCCommand<T>('cy_storage_retrieve', {
        path
      });
    }
    throw new Error(`Can't retrieve to storage: Missing connection of type message`);
  }

  /**
   * run by primary only
   * @param signal
   */
  private static initPrimaryShutdownRoutine(
    shutdownOptions?: ClusterfyShutdownOptions
  ) {
    if (shutdownOptions?.gracefulOnSignals) {
      for (const signal of shutdownOptions.gracefulOnSignals) {
        process.on(signal, Clusterfy.onPrimaryShutdown);
      }
    }
  }

  /** run by primary only
   *
   */
  private static destroyPrimary = () => {
    if (cluster.isPrimary) {
      if (this._connections) {
        for (const connection of this._connections) {
          connection.destroy();
        }
      }

      process.removeAllListeners();
      /** TODO move to socket server connection
       this._socketServer?.close(() => {
       console.log('CLOSED!');
       });
       **/
    } else {
      process.removeAllListeners();
    }
  };

  /**
   * run by primary only
   * @param signal
   */
  private static onPrimaryShutdown = (signal?: NodeJS.Signals) => {
    if (Clusterfy._shutdownRunning) {
      // shutdown already called, ignore this call
      return;
    }
    Clusterfy._shutdownRunning = true;

    const promises = [];
    for (const shutdownCommand of Clusterfy._shutdownCommands) {
      promises.push(shutdownCommand.command(signal));
    }

    Promise.all(promises).then(() => {
      process.exit(0);
    });
  };
}
