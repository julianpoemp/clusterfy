import * as process from 'process';
import * as _cluster from 'cluster';
import {
  ClusterfyCommandRequest,
  ClusterfyIPCEvent,
  ClusterfyWorkerStatistics,
} from './types';
import { Subject } from 'rxjs';
import { v4 as UUIDv4 } from 'UUID';
import {
  ClusterfyCommand,
  ClusterfyIPCCommands,
  ClusterfyStorageRetrieveCommand,
  ClusterfyStorageSaveCommand,
  ClusterfyTimestampGetCommand,
  ClusterfyWorkerMetadataCommand,
} from './commands';

const cluster = _cluster as unknown as _cluster.Cluster;

export class Clusterfy {
  static get currentWorker(): ClusterfyWorker {
    return this._currentWorker;
  }

  static get storage(): ClusterfyStorage<unknown> {
    return this._storage;
  }

  static get events(): Subject<ClusterfyIPCEvent> {
    return this._events;
  }

  static get workers(): ClusterfyWorker[] {
    return this._workers;
  }

  private static _workers: ClusterfyWorker[] = [];
  private static _storage: ClusterfyStorage<unknown>;
  private static _events: Subject<ClusterfyIPCEvent>;
  private static _currentWorker: ClusterfyWorker;
  private static _commands: ClusterfyIPCCommands = {
    storage_save: new ClusterfyStorageSaveCommand(),
    storage_retrieve: new ClusterfyStorageRetrieveCommand(),
    get_timestamp: new ClusterfyTimestampGetCommand(),
    worker_set_metadata: new ClusterfyWorkerMetadataCommand(),
  };

  static init<T>(storage: ClusterfyStorage<T>) {
    Clusterfy._storage = storage;
  }

  static fork(name?: string): ClusterfyWorker {
    const worker = new ClusterfyWorker(cluster.fork(), name);
    this._workers.push(worker);
    worker.worker.addListener('online', () => {
      Clusterfy.onWorkerOnline(worker, name);
    });

    return worker;
  }

  static initAsPrimary() {
    if (!cluster.isPrimary) {
      throw new Error(
        `Can't initialize clusterfy as primary. Current process is worker process.`
      );
    }

    Clusterfy._events = new Subject<ClusterfyIPCEvent>();

    for (let i = 0; i < Clusterfy._workers.length; i++) {
      const worker = Clusterfy._workers[i];
      worker.worker.on('message', (message) => {
        Clusterfy.onMessageReceived(worker, message);
      });
    }
  }

  static initAsWorker() {
    if (cluster.isPrimary) {
      throw new Error(
        `Can't initialize clusterfy as worker. Current process is primary.`
      );
    }

    this._currentWorker = new ClusterfyWorker(cluster.worker);
    this._events = new Subject<ClusterfyIPCEvent>();
    process.on('message', (message: ClusterfyIPCEvent) => {
      Clusterfy.onMessageReceived(undefined, message);
    });
  }

  /***
   * sends a message to primary process or a worker. If workerID is undefined the message is sent to all workers.
   * @param target
   * @param message
   * @param targetID
   * @param redirection
   */
  static sendMessage(
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
        process.send(message, handle);
      } else {
        // send to worker
        const sendMessage = (worker: _cluster.Worker) => {
          if (worker) {
            worker.send(message, handle);
          } else {
            console.log(`Error: Worker not found with id ${target.id}`);
          }
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

  static onMessageReceived = (
    worker?: ClusterfyWorker,
    message?: ClusterfyIPCEvent
  ): void => {
    const sender = this._workers.find((a) => a.worker.id === message.senderID);

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

      if (
        (commandObject.target === 'primary' &&
          Clusterfy.isCurrentProcessPrimary()) || // or target is worker
        (commandObject.target === 'worker' &&
          !Clusterfy.isCurrentProcessPrimary() &&
          (!convertedEvent.target?.id ||
            convertedEvent.target.id === Clusterfy._currentWorker.worker.id) &&
          (!convertedEvent.originID ||
            convertedEvent.originID !== Clusterfy._currentWorker.worker.id))
      ) {
        let returnDirection: 'primary' | 'worker' = 'worker';

        if (commandObject.target === 'worker') {
          returnDirection = 'primary';
          if (convertedEvent.target?.id) {
            // message from worker to worker => switch sender with target
            const senderID = convertedEvent.senderID;
            convertedEvent.senderID = convertedEvent.target?.id;
            convertedEvent.target = { id: senderID };
          }
        }

        commandObject
          .runOnTarget(parameters, convertedEvent)
          .then((result) => {
            const response = { ...convertedEvent };
            response.data.result = result;
            Clusterfy.sendMessage(
              {
                type: returnDirection,
                id: convertedEvent.senderID,
              },
              response
            ).catch((error) => {
              console.log(`Clusterfy ERROR: ${error}`);
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
                id: convertedEvent.senderID,
              },
              convertedEvent
            ).catch((error) => {
              console.log(`Clusterfy ERROR: ${error}`);
            });
          });
      } else if (
        Clusterfy.isCurrentProcessPrimary() &&
        convertedEvent.target?.id &&
        convertedEvent.senderID
      ) {
        const targetID = convertedEvent.target?.id;
        if (convertedEvent.target.id == convertedEvent.originID) {
          convertedEvent.senderID = undefined;
          convertedEvent.target = undefined;
        }
        Clusterfy.sendMessage(
          {
            type: 'worker',
            id: targetID,
          },
          convertedEvent
        ).catch((error) => {
          console.log(`Clusterfy ERROR: ${error}`);
        });
      }
    }

    Clusterfy._events.next(message);
  };

  static onWorkerOnline = (worker: ClusterfyWorker, name?: string) => {
    Clusterfy.runIPCCommand<void>(
      this._commands.worker_set_metadata.name,
      { name },
      {
        id: worker.worker.id,
      }
    );
  };

  static async saveToStorage(path: string, value: any): Promise<void> {
    return this.runIPCCommand<void>('storage_save', { path, value });
  }

  private static waitForCommandResultEvent<T>(command: string, uuid?: string) {
    return new Promise<T>((resolve, reject) => {
      const subscription = this._events.subscribe({
        next: (event: ClusterfyCommandRequest<any>) => {
          if (
            event.data.command === command &&
            event.data.uuid &&
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

  static retrieveFromStorage<T>(path: string): Promise<T> {
    return this.runIPCCommand<T>('storage_retrieve', { path });
  }

  static getStatistics(): ClusterfyWorkerStatistics {
    if (!cluster.isPrimary) {
      throw new Error(
        `Can't read statistics. Current process is worker process.`
      );
    }
    const result: ClusterfyWorkerStatistics = {
      list: [],
    };

    for (const worker of this._workers) {
      result.list.push({
        id: worker.worker.id,
        name: worker.name,
        status: worker.status,
      });
    }

    return result;
  }

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

  static registerIPCCommand(command: ClusterfyCommand) {
    if (Object.keys(Clusterfy._commands).includes(command.name)) {
      throw new Error(`Command ${command.name} already exists`);
    }
    Clusterfy._commands[command.name] = command;
  }

  static async runIPCCommand<T>(
    command: string,
    args: Record<string, any>,
    target?: {
      name?: string;
      id?: number;
    }
  ): Promise<T> {
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
        (!target?.id ||
          target.id === Clusterfy._currentWorker.worker.id ||
          !target?.name ||
          target.name === Clusterfy._currentWorker.name))
    ) {
      const result = await commandObject.runOnTarget(args);
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
          senderID: cluster.worker?.id,
          target,
          originID: Clusterfy._currentWorker?.worker.id,
          timestamp: Date.now(),
        } as ClusterfyCommandRequest<any>,
        commandObject.target === 'worker' &&
          !Clusterfy.isCurrentProcessPrimary()
      );
      return Clusterfy.waitForCommandResultEvent(command, uuid);
    }
  }

  static destroy() {
    if (cluster.isPrimary) {
      for (const { worker } of this._workers) {
        worker.off('message', Clusterfy.onMessageReceived);
        worker.off('online', Clusterfy.onWorkerOnline);
      }
    } else {
      process.off('message', Clusterfy.onMessageReceived);
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
  set name(value: string) {
    this._name = value;
  }

  get name(): string {
    return this._name;
  }

  get worker(): _cluster.Worker {
    return this._worker;
  }

  get status(): string {
    return this._status;
  }

  private _worker: _cluster.Worker;
  private _status: 'idle' | 'running' | 'stopping' = 'idle';
  private _name: string;

  constructor(worker: _cluster.Worker, name?: string) {
    this._worker = worker;
    this._name = name;
  }
}
