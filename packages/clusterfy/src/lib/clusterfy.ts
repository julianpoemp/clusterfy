import * as process from 'process';
import * as _cluster from 'cluster';
import { Address } from 'cluster';
import {
  ClusterfyCommandRequest,
  ClusterfyIPCEvent,
  ClusterfyShutdownOptions,
  ClusterfyWorkerOptions,
  ClusterfyWorkerStatistics,
  ClusterfyWorkerStatus,
} from './types';
import { Subject, Subscription, timer } from 'rxjs';
import { v4 as UUIDv4 } from 'uuid';
import {
  ClusterfyCommand,
  ClusterfyIPCCommands,
  ClusterfyShutdownCommand,
  ClusterfyStatusChangeCommand,
  ClusterfyStorageRetrieveCommand,
  ClusterfyStorageSaveCommand,
  ClusterfyTimestampGetCommand,
  ClusterfyWorkerMetadataCommand,
} from './commands';

const cluster = _cluster as unknown as _cluster.Cluster;

export class Clusterfy {
  /**
   * returns the current worker. Undefined on primary.
   */
  static get currentWorker(): ClusterfyWorker | undefined {
    return this._currentWorker;
  }

  /**
   * Returns "Primary" on primary or "Workername (id)" on worker.
   */
  static get currentLabel(): string {
    if (Clusterfy.isCurrentProcessPrimary()) {
      return `Primary`;
    } else {
      return `${Clusterfy._currentWorker?.name} (${Clusterfy._currentWorker?.worker.id})`;
    }
  }

  /**
   * Returns shared storage (only on primary). Returns undefined else.
   */
  static get storage(): ClusterfyStorage<unknown> {
    return this._storage;
  }

  /**
   * Returns observable of all events to this worker or primary.
   */
  static get events(): Subject<ClusterfyIPCEvent> {
    return this._events;
  }

  /**
   * Returns array of workers (only on primary). Returns empty array else.
   */
  static get workers(): ClusterfyWorker[] {
    return this._workers;
  }

  private static _workers: ClusterfyWorker[] = [];
  private static _storage: ClusterfyStorage<unknown>;
  private static _events: Subject<ClusterfyIPCEvent> =
    new Subject<ClusterfyIPCEvent>();
  private static _currentWorker: ClusterfyWorker;
  private static _commands: ClusterfyIPCCommands = {
    cy_storage_save: new ClusterfyStorageSaveCommand(),
    cy_storage_retrieve: new ClusterfyStorageRetrieveCommand(),
    cy_get_timestamp: new ClusterfyTimestampGetCommand(),
    cy_worker_set_metadata: new ClusterfyWorkerMetadataCommand(),
    cy_shutdown: new ClusterfyShutdownCommand(),
    cy_status_change: new ClusterfyStatusChangeCommand(),
  };

  private static _shutdownRunning = false;
  private static _shutdownCommands: {
    command: (signal?: NodeJS.Signals) => Promise<void>;
    name: string;
  }[] = [];

  /**
   * Initializes the storage. Call this method on primary. The storage must be an object, e.g.
   * @param storage
   */
  static initStorage<T>(storage: ClusterfyStorage<T>) {
    Clusterfy._storage = storage;
  }

  /**
   * Creates a new worker with given name and options.
   * @param name
   * @param options
   */
  static fork(
    name?: string,
    options?: ClusterfyWorkerOptions
  ): ClusterfyWorker {
    const worker = new ClusterfyWorker(cluster.fork(), name, options);
    this._workers.push(worker);
    worker.worker.on('online', () => {
      Clusterfy.onWorkerOnline(worker, name);
    });
    worker.worker.on('disconnect', () => {
      Clusterfy.onWorkerDisconnect(worker);
    });
    worker.worker.on('error', (error: Error) => {
      Clusterfy.onWorkerError(worker, error);
    });
    worker.worker.on('exit', (code: number, signal: string) => {
      Clusterfy.onWorkerExit(worker, code, signal);
    });
    worker.worker.on('listening', (address: Address) => {
      Clusterfy.onWorkerListening(worker, address);
    });
    worker.worker.on('message', (message) => {
      Clusterfy.onMessageReceived(worker, message);
    });

    return worker;
  }

  /**
   * Initializes the primary with Clusterfy. This method must be called on primary (see example). If you want to include
   * graceful shutdown on process signals you need to add `shutdownOptions`.
   * @param shutdownOptions
   */
  static async initAsPrimary(shutdownOptions?: ClusterfyShutdownOptions) {
    if (!cluster.isPrimary) {
      throw new Error(
        `Can't initialize clusterfy as primary. Current process is worker process.`
      );
    }

    process.on('exit', () => {
      Clusterfy.destroy();
    });

    Clusterfy.initShutdownRoutine(shutdownOptions);

    const promises = [];
    for (const worker of this._workers) {
      promises.push(
        this.waitForStatus(worker, [
          ClusterfyWorkerStatus.IDLE,
          ClusterfyWorkerStatus.PROCESSING,
        ])
      );
    }

    return Promise.all(promises);
  }

  static async waitForStatus(
    worker: ClusterfyWorker,
    status: ClusterfyWorkerStatus[]
  ) {
    return new Promise<void>((resolve, reject) => {
      if (status.includes(worker.status)) {
        resolve();
      } else {
        const subscription = Clusterfy._events.subscribe({
          next: (event) => {
            if (
              event.type === 'status' &&
              event.sender.id === worker.worker.id &&
              status.includes(event.data.newStatus)
            ) {
              subscription.unsubscribe();
            }
            resolve();
          },
        });
      }
    });
  }

  /**
   * Initializes the worker with Clusterfy and waits for metadata from primary. This method must be called on worker (see
   * example). Wait until this method returns. If you want to include graceful shutdown on process signals you need to
   * add `shutdownOptions`.
   * @param shutdownOptions
   */
  static async initAsWorker(
    shutdownOptions?: ClusterfyShutdownOptions
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (cluster.isPrimary) {
        reject(
          new Error(
            `Can't initialize clusterfy as worker. Current process is primary.`
          )
        );
      }

      Clusterfy.initShutdownRoutine(shutdownOptions);

      process.on('exit', () => {
        Clusterfy.destroy();
      });
      process.on('message', (message: ClusterfyIPCEvent) => {
        Clusterfy.onMessageReceived(undefined, message);
      });

      Clusterfy._currentWorker = new ClusterfyWorker(cluster.worker);
      const subscr = this._events.subscribe({
        next: (event) => {
          if (
            event.type === 'result' &&
            event.data.command === this._commands.cy_worker_set_metadata.name &&
            event.data?.result?.status === 'success'
          ) {
            Clusterfy._currentWorker.name = event.data?.result?.data?.name;

            Clusterfy.sendMessage(
              {
                type: 'primary',
              },
              {
                type: 'ready',
                timestamp: Date.now(),
                sender: {
                  id: Clusterfy._currentWorker?.worker?.id,
                  name: Clusterfy._currentWorker?.name,
                },
              }
            );

            this._events.next({
              type: 'ready',
              timestamp: Date.now(),
            });
            Clusterfy.changeCurrentWorkerStatus(ClusterfyWorkerStatus.IDLE);

            subscr.unsubscribe();
            resolve();
          }
        },
      });
      Clusterfy.changeCurrentWorkerStatus(ClusterfyWorkerStatus.LOADED);
    });
  }

  private static initShutdownRoutine(
    shutdownOptions?: ClusterfyShutdownOptions
  ) {
    if (shutdownOptions?.gracefulOnSignals) {
      for (const signal of shutdownOptions.gracefulOnSignals) {
        process.on(signal, Clusterfy.onShutdown);
      }
    }
  }

  /***
   * sends a message to primary process or a worker. If workerID is undefined the message is sent to all workers.
   * @param target
   * @param message
   * @param targetID
   * @param redirection
   */
  private static sendMessage(
    target: {
      type: string;
      name?: string;
      id?: number;
    },
    message: ClusterfyIPCEvent,
    redirection = false
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const handle = (error: Error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };

      if (target.type === 'primary' || redirection) {
        if (!Clusterfy.currentWorker?.worker.isDead()) {
          process.send(message, handle);
        } else {
          handle(new Error(`Worker ${Clusterfy.currentWorker?.name} is dead.`));
        }
      } else {
        // send to worker
        const sendMessage = (worker: _cluster.Worker) => {
          if (!worker) {
            handle(new Error(`Error: Worker not found with id ${target.id}`));
          }
          if (worker.isDead()) {
            handle(
              new Error(`Worker ${Clusterfy.currentWorker?.name} is dead.`)
            );
          }

          worker.send(message, handle);
        };

        if (target?.id || target?.name) {
          const clusterfyWorker = this._workers.find(
            (a) =>
              (target?.id && a.worker.id === target.id) ||
              (target?.name && a.name === target.name)
          );

          if (!clusterfyWorker) {
            reject(
              new Error(
                `Can't find worker with id, name: ${target?.id}, ${target.name}`
              )
            );
          } else {
            sendMessage(clusterfyWorker.worker);
          }
        } else {
          for (const worker of this._workers) {
            sendMessage(worker.worker);
          }
        }
      }
    });
  }

  private static onMessageReceived = (
    worker?: ClusterfyWorker,
    message?: ClusterfyIPCEvent
  ): void => {
    if (message.type === 'command') {
      const convertedEvent = { ...message } as ClusterfyCommandRequest<any>;
      const parameters = convertedEvent.data.args;
      const commandObject = this._commands[convertedEvent.data.command];
      if (!commandObject) {
        this._events.error(
          new Error(`Can't run command "${commandObject.name}". Not found.`)
        );
        return;
      }

      if (Clusterfy.isCurrentProcessPrimary()) {
        if (!message.target?.id && message.target?.name) {
          const found = this._workers.find(
            (a) => a.name === message.target.name
          );
          convertedEvent.target = {
            id: found?.worker.id,
            name: found?.name,
          };
        }
      }

      if (
        (commandObject.target === 'primary' &&
          Clusterfy.isCurrentProcessPrimary()) || // or target is worker
        (commandObject.target === 'worker' &&
          !Clusterfy.isCurrentProcessPrimary() &&
          (!convertedEvent.target?.id ||
            convertedEvent.target.id === cluster.worker.id) &&
          (!convertedEvent.origin?.id ||
            convertedEvent.origin?.id !== cluster.worker.id))
      ) {
        let returnDirection: 'primary' | 'worker' = 'worker';

        if (commandObject.target === 'worker') {
          returnDirection = 'primary';
          if (convertedEvent.target?.id) {
            // message from worker to worker => switch sender with target
            const sender = { ...convertedEvent.sender };
            convertedEvent.sender = { ...convertedEvent.target };
            convertedEvent.target = sender;
          }
        }

        Clusterfy.runOnTarget(commandObject, parameters, convertedEvent)
          .then((result) => {
            const response = { ...convertedEvent };
            response.data.result = result;
            Clusterfy.sendMessage(
              {
                type: returnDirection,
                ...convertedEvent.sender,
              },
              response
            ).catch((error) => {
              this._events.error(error);
            });
          })
          .catch((error) => {
            convertedEvent.data.result = {
              status: 'error',
              error: {
                message: error?.message ?? error,
                stack: error?.stack,
              },
            };
            Clusterfy.sendMessage(
              {
                type: returnDirection,
                ...convertedEvent.sender,
              },
              convertedEvent
            ).catch((error) => {
              this._events.error(error);
            });
          });
      } else if (
        Clusterfy.isCurrentProcessPrimary() &&
        convertedEvent.target?.id &&
        convertedEvent.sender?.id
      ) {
        const target = { ...convertedEvent.target };
        if (convertedEvent.target.id == convertedEvent.origin?.id) {
          convertedEvent.sender = undefined;
          convertedEvent.target = undefined;
        }
        Clusterfy.sendMessage(
          {
            type: 'worker',
            ...target,
          },
          convertedEvent
        ).catch((error) => {
          this._events.error(error);
        });
      }
    }

    if (
      message.type === 'command' &&
      message.data?.command === 'cy_status_change'
    ) {
      Clusterfy._events.next({
        ...message,
        type: 'status',
        data: message?.data?.args,
      });
    } else {
      Clusterfy._events.next(message);
    }
  };
  private static runOnTarget = async (
    commandObject: ClusterfyCommand,
    args: Record<string, any>,
    commandEvent?: ClusterfyCommandRequest<any>
  ) => {
    if (commandEvent.data?.command === Clusterfy._commands.cy_shutdown.name) {
      args = {
        commands: Clusterfy._shutdownCommands,
      };
    }

    const result = await commandObject.runOnTarget(args, commandEvent);
    this._events.next({
      timestamp: Date.now(),
      type: 'result',
      data: {
        command: commandObject.name,
        result,
      },
    });
    return result;
  };

  private static onWorkerOnline = async (
    worker: ClusterfyWorker,
    name?: string
  ) => {
    await this.waitForStatus(worker, [ClusterfyWorkerStatus.LOADED]);
    Clusterfy.runIPCCommand<void>(
      this._commands.cy_worker_set_metadata.name,
      { name },
      {
        id: worker.worker.id,
        name: worker.name,
      }
    );

    this._events.next({
      type: 'online',
      sender: {
        id: worker.worker.id,
        name: worker.name,
      },
      timestamp: Date.now(),
    });
  };

  private static onWorkerDisconnect = (worker: ClusterfyWorker) => {
    this._events.next({
      type: 'disconnect',
      sender: {
        id: worker.worker.id,
        name: worker.name,
      },
      timestamp: Date.now(),
    });
  };

  private static onWorkerError = (worker: ClusterfyWorker, error: Error) => {
    this._events.next({
      type: 'error',
      data: error,
      sender: {
        id: worker.worker.id,
        name: worker.name,
      },
      timestamp: Date.now(),
    });
  };

  private static onWorkerExit = (
    worker: ClusterfyWorker,
    code: number,
    signal: string
  ) => {
    this._workers = this._workers.filter(
      (a) => a.worker.id !== worker.worker.id
    );

    this._events.next({
      type: 'exit',
      data: {
        code,
        signal,
      },
      sender: {
        id: worker.worker.id,
        name: worker.name,
      },
      timestamp: Date.now(),
    });

    if (worker.options.revive && !signal && code > 0) {
      //revive worker
      Clusterfy.fork(worker.name, worker.options);
    }
  };

  private static onWorkerListening = (
    worker: ClusterfyWorker,
    address: Address
  ) => {
    this._events.next({
      type: 'listening',
      data: {
        address,
      },
      sender: {
        id: worker.worker.id,
        name: worker.name,
      },
      timestamp: Date.now(),
    });
  };

  private static onShutdown = (signal?: NodeJS.Signals) => {
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

  /**
   * Registers a new method that is run on shutdown.
   * @param name
   * @param command
   */
  static registerShutdownMethod = (
    name: string,
    command: (signal: NodeJS.Signals) => Promise<void>
  ) => {
    const index = Clusterfy._shutdownCommands.findIndex((a) => a.name === name);

    if (index < 0) {
      this._shutdownCommands.push({
        name,
        command,
      });
    } else {
      throw new Error(
        `Can't add shutdown command. A command with this name already exists.`
      );
    }
  };

  /**
   * Removes an existing shutdown method.
   * @param name
   */
  static removeShutdownMethod = (name: string) => {
    const index = Clusterfy._shutdownCommands.findIndex((a) => a.name === name);
    if (index > -1) {
      Clusterfy._shutdownCommands.splice(index, 1);
    } else {
      throw new Error(`Can't remove shutdown command. Not found.`);
    }
  };

  /**
   * If you call `Clusterfy.shutdownWorker(worker, 2000)` from primary it sends a cy_shutdown command to a worker. The worker
   * gets status "STOPPING" and should exit itself using `process.exit(0)` in 2 seconds (graceful shutdown). If the worker
   * doesn't exit itself, the primary kill it.
   *
   * That means: the algorithm you are using for processing in a worker should check if the status is "STOPPING" using
   * `Clusterfy.currentWorker.status` and then exit itself. The algorithm should also change the status to "
   * PROCESSING" after it started processing and change itback to "IDLE" after finished. If a shutdown is received
   * Clusterfy checks if the status is "IDLE" and calls `process.exit(0)` or changes the status to "STOPPING".
   * @param worker
   * @param timeout
   */
  static async shutdownWorker(worker: ClusterfyWorker, timeout = 2000) {
    return new Promise<void>((resolve, reject) => {
      if (!this.isCurrentProcessPrimary()) {
        reject(new Error(`Only primary can shutdown workers`));
        return;
      }

      let timerSubscription: Subscription = undefined;
      const exitSubscription = this._events.subscribe({
        next: (event) => {
          if (event.type === 'exit' && event.sender?.id === worker.worker.id) {
            exitSubscription.unsubscribe();
            resolve();
          }
        },
      });
      const disconnectSubscription = this._events.subscribe({
        next: (event) => {
          if (
            event.type === 'disconnect' &&
            event.sender?.id === worker.worker.id
          ) {
            timerSubscription.unsubscribe();
            disconnectSubscription.unsubscribe();
          }
        },
      });

      this.runIPCCommand<void>('cy_shutdown', undefined, {
        id: worker.worker.id,
        name: worker.name,
      }).catch(reject);
      worker.worker.disconnect();

      timerSubscription = timer(timeout).subscribe({
        next: () => {
          worker.worker.kill();
        },
      });
    });
  }

  /**
   * Saves a serializable value to a path in the shared storage on primary. Path should be a string with dot notation to the
   * attribute , e.g. "test.something". This method returns as soon as saved.
   * @param path
   * @param value
   */
  static async saveToStorage(path: string, value: any): Promise<void> {
    return this.runIPCCommand<void>(this._commands.cy_storage_save.name, {
      path,
      value,
    });
  }

  private static waitForCommandResultEvent<T>(command: string, uuid?: string) {
    return new Promise<T>((resolve, reject) => {
      const subscription = this._events.subscribe({
        next: (event: ClusterfyCommandRequest<any>) => {
          if (
            event.type === 'command' &&
            event.data?.command === command &&
            event.data?.uuid &&
            uuid === event.data.uuid
          ) {
            subscription.unsubscribe();
            if (event.data.result.status === 'success') {
              resolve(event.data.result.data);
            } else {
              reject({
                message: event.data.result.error.message,
                stack: event.data.result.error.stack,
              });
            }
          }
        },
      });
    });
  }

  /**
   * Returns a serializable value from a given path in shared storage. Path should be a string with dot notation to the
   * attribute , e.g. "test.something". This method returns the value of type `T` as soon as retrieved.
   * @param path
   */
  static async retrieveFromStorage<T>(path: string): Promise<T> {
    return this.runIPCCommand<T>(this._commands.cy_storage_retrieve.name, {
      path,
    });
  }

  /**
   * Returns a object with statistics about the workers. Call it on primary.
   */
  static getStatistics(): ClusterfyWorkerStatistics {
    if (!cluster.isPrimary) {
      throw new Error(
        `Can't read statistics. Current process is worker process.`
      );
    }
    const result: ClusterfyWorkerStatistics = {
      list: [],
      workersOnline: 0,
    };

    for (const worker of this._workers) {
      result.list.push({
        id: worker.worker.id,
        name: worker.name,
        status: worker.status,
      });
      result.workersOnline += worker.worker.isDead() ? 0 : 1;
    }

    return result;
  }

  /**
   * Outputs statistics from getStatistics to console. Call it on primary.
   */
  static outputStatisticsTable() {
    if (Clusterfy.isCurrentProcessPrimary()) {
      const statistics = Clusterfy.getStatistics();
      console.log('____________________Clusterfy Statistics_________________');
      console.log('|\tid\t|\tname\t\t|\tstatus\t|\tstorage\t');
      console.log(`---------------------------------------------------------`);

      for (const { id, name, status } of statistics.list) {
        console.log(
          `|\t${id}\t|\t${name}\t|\t${status}\t|\t${JSON.stringify(
            this._storage
          )}\t`
        );
      }

      console.log(`---------------------------------------------------------`);
    }
  }

  /**
   * Registers a new custom command to the list of supported commands. Call this method on worker and primary.
   * @param command
   */
  static registerIPCCommand(command: ClusterfyCommand) {
    if (Object.keys(Clusterfy._commands).includes(command.name)) {
      throw new Error(`Command ${command.name} already exists`);
    }
    Clusterfy._commands[command.name] = command;
  }

  static async runIPCCommand<T>(
    command: string,
    args?: Record<string, any>,
    target?: {
      name?: string;
      id?: number;
    }
  ): Promise<T> {
    args = args ?? {};
    const commandObject = this._commands[command];

    if (target && Object.keys(target).length === 0) {
      throw new Error(`You have to set either target name or id.`);
    }

    if (!commandObject) {
      throw new Error(`Can't run command "${command}". Not found.`);
    }

    if (
      (commandObject.target === 'primary' &&
        Clusterfy.isCurrentProcessPrimary()) ||
      (commandObject.target === 'worker' &&
        !Clusterfy.isCurrentProcessPrimary() &&
        ((!target?.id && !target?.name) ||
          (!target?.id && target?.id === cluster.worker.id) ||
          (!target?.name && target.name === Clusterfy._currentWorker.name)))
    ) {
      const result = await Clusterfy.runOnTarget(commandObject, args);
      return result.data;
    } else {
      const uuid = UUIDv4();
      await this.sendMessage(
        {
          ...target,
          type: commandObject.target,
        },
        {
          type: 'command',
          data: {
            command,
            args,
            uuid,
          },
          sender: {
            id: cluster.worker?.id,
            name: this.currentWorker?.name,
          },
          target,
          origin: {
            id: cluster.worker?.id,
            name: this.currentWorker?.name,
          },
          timestamp: Date.now(),
        } as ClusterfyCommandRequest<any>,
        commandObject.target === 'worker' &&
          !Clusterfy.isCurrentProcessPrimary()
      );
      return Clusterfy.waitForCommandResultEvent(command, uuid);
    }
  }

  /**
   * Changes the status of the current worker and emits event of type "status" to itself and to primary.
   * @param newStatus
   */
  static changeCurrentWorkerStatus(newStatus: ClusterfyWorkerStatus) {
    if (this.isCurrentProcessPrimary()) {
      throw new Error(
        `changeCurrentWorkerStatus must be called on worker process.`
      );
    }

    const data = {
      newStatus,
      oldStatus: this.currentWorker.status,
    };

    this.currentWorker.changeStatus(newStatus);
    this._events.next({
      type: 'status',
      data,
      timestamp: Date.now(),
    });

    this.runIPCCommand<void>(this._commands.cy_status_change.name, data);
  }

  private static destroy() {
    if (cluster.isPrimary) {
      for (const { worker } of this._workers) {
        worker.removeAllListeners();
      }
      process.removeAllListeners();
    } else {
      process.removeAllListeners();
    }
  }

  static isCurrentProcessPrimary() {
    return cluster.isPrimary;
  }
}

export class ClusterfyStorage<T> {
  private _snapshot: T;

  constructor(initState: T) {
    this._snapshot = initState;
  }

  save(path: string, value: any) {
    const splitted = this.readPath(path);
    this._snapshot = this.saveValueToObject(this._snapshot, value, splitted);
  }

  retrieve<S>(path: string): S {
    const splitted = this.readPath(path);
    return this.readValueFromObject(this._snapshot, splitted);
  }

  private readPath(path: string): string[] {
    if (!path) {
      throw new Error("Can't read path. Path must not be empty or undefined");
    }
    const splitted = path.split('.').filter((a) => a !== '' && a !== undefined);
    if (splitted.length === 0) {
      throw new Error(
        `Can't save value to ClusterfyStorage. Missing points in string.`
      );
    }

    return splitted;
  }

  private saveValueToObject(
    object: any,
    value: any,
    remaining: string[],
    processed: string[] = []
  ) {
    if (remaining.length === 0) {
      return object;
    }

    const attr = remaining[0];
    processed.push(attr);
    if (Object.keys(object).includes(attr) || remaining.length === 1) {
      if (remaining.length > 1) {
        object[attr] = this.saveValueToObject(
          object[attr],
          value,
          remaining.slice(1),
          processed
        );
      } else {
        object[attr] = value;
      }
    } else {
      throw new Error(
        `Can't save value to ClusterfyStorage. Key '${processed.join(
          '.'
        )}' does not exist.`
      );
    }

    return object;
  }

  private readValueFromObject(
    object: any,
    remaining: string[],
    processed: string[] = []
  ) {
    if (remaining.length === 0) {
      return object;
    }

    const attr = remaining[0];
    processed.push(attr);
    if (Object.keys(object).includes(attr) || remaining.length === 1) {
      if (remaining.length > 1) {
        return this.readValueFromObject(
          object[attr],
          remaining.slice(1),
          processed
        );
      } else {
        return object[attr];
      }
    } else {
      throw new Error(
        `Can't save value to ClusterfyStorage. Key '${processed.join(
          '.'
        )}' does not exist.`
      );
    }

    return object;
  }
}

export class ClusterfyWorker {
  get options(): ClusterfyWorkerOptions {
    return this._options;
  }

  get status(): ClusterfyWorkerStatus {
    return this._status;
  }

  set name(value: string) {
    this._name = value;
  }

  get name(): string {
    return this._name;
  }

  get worker(): _cluster.Worker {
    return this._worker;
  }

  private _worker: _cluster.Worker;
  private _status: ClusterfyWorkerStatus = ClusterfyWorkerStatus.INITIALIZING;
  private _name: string;

  private _options: ClusterfyWorkerOptions = {
    revive: false,
  };

  public changeStatus(status: ClusterfyWorkerStatus) {
    this._status = status;
  }

  constructor(
    worker: _cluster.Worker,
    name?: string,
    options?: ClusterfyWorkerOptions
  ) {
    this._worker = worker;
    this._name = name;
    this._options = options ?? this._options;
  }
}
