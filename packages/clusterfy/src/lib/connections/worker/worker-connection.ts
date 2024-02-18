import * as _cluster from 'cluster';
import {
  ClusterfyCommandRequest,
  ClusterfyIPCEvent,
  ClusterfyIPCMethod,
  ClusterfyPrimaryOptions,
  ClusterfyShutdownOptions,
  ClusterfyWorkerOptions
} from '../../types';
import { ClusterfyConnection } from '../connection';
import { Subject } from 'rxjs';
import * as process from 'process';
import { ClusterfyCommand } from '../../commands';
import { ClusterfyWorker, ClusterfyWorkerStatus } from './clusterfy-worker';
import { WorkerCommands } from './clusterfy-worker.commands';
import { v4 as UUIDv4 } from 'uuid';

const cluster = _cluster as unknown as _cluster.Cluster;

export class ClusterfyWorkerConnection extends ClusterfyConnection {
  override _type: 'message' | 'os-socket' | 'tcp-socket' = 'message';
  private _currentWorker: ClusterfyWorker;
  private _shutdownRunning = false;
  protected override _options: ClusterfyPrimaryOptions | ClusterfyWorkerOptions = {};

  private _workers: ClusterfyWorker[] = [];
  private _events: Subject<ClusterfyIPCEvent> =
    new Subject<ClusterfyIPCEvent>();
  private _commands: Record<string, ClusterfyCommand> = {};

  private _shutdownCommands: {
    command: (signal?: NodeJS.Signals) => Promise<void>;
    name: string;
  }[] = [];


  get workers(): ClusterfyWorker[] {
    return this._workers;
  }

  /**
   * returns the current worker. Undefined on primary.
   */
  get currentWorker(): ClusterfyWorker | undefined {
    return this._currentWorker;
  }

  constructor(options: ClusterfyPrimaryOptions | ClusterfyWorkerOptions, primaryCommands: Record<string, ClusterfyCommand>) {
    super(options);

    if (cluster.isWorker) {
      this._commands = new WorkerCommands(this) as Record<string, any>;
    }

    for (const key of Object.keys(primaryCommands)) {
      this._commands[key] = primaryCommands[key];
    }
  }

  override async connect() {
    if (cluster.isPrimary) {
      return this.initAsPrimary(this.options);
    }
    return this.initAsWorker(this.options);
  }

  registerCommands(commands: Record<string, ClusterfyCommand>) {
    const keys = Object.keys(commands);
    for (const key of keys) {
      this._commands[key] = commands[key];
    }
  }

  /**
   * Changes the status of the current worker and emits event of type "status" to itself and to primary.
   * @param newStatus
   */
  changeCurrentWorkerStatus(newStatus: ClusterfyWorkerStatus) {
    if (cluster.isWorker) {
      const data = {
        newStatus,
        oldStatus: this.currentWorker.status
      };

      this.currentWorker.changeStatus(newStatus);
      this._events.next({
        type: 'status',
        data,
        timestamp: Date.now()
      });

      this.runIPCCommand<void>('cy_status_change', data);
    } else {
      throw new Error(`Not a worker`);
    }
  }

  async runIPCCommand<T>(
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
        cluster.isPrimary) ||
      (commandObject.target === 'worker' &&
        !cluster.isPrimary &&
        ((!target?.id && !target?.name) ||
          (!target?.id && target?.id === cluster.worker.id) ||
          (!target?.name && target.name === this._currentWorker.name)))
    ) {
      const result = await this.runOnTarget(commandObject, args);
      return result.data;
    } else {
      const uuid = UUIDv4();
      await this.sendMessage(
        {
          ...target,
          type: commandObject.target
        },
        {
          type: 'command',
          data: {
            command,
            args,
            uuid
          },
          sender: {
            id: cluster.worker?.id,
            name: this.currentWorker?.name
          },
          target,
          origin: {
            id: cluster.worker?.id,
            name: this.currentWorker?.name
          },
          timestamp: Date.now()
        } as ClusterfyCommandRequest<any>,
        commandObject.target === 'worker' &&
        !cluster.isPrimary
      );
      return this.waitForCommandResultEvent(command, uuid);
    }
  }


  private waitForCommandResultEvent<T>(command: string, uuid?: string) {
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
                stack: event.data.result.error.stack
              });
            }
          }
        }
      });
    });
  }

  /**
   * Initializes the primary with Clusterfy. This method must be called on primary (see example). If you want to include
   * graceful shutdown on process signals you need to add `shutdownOptions`.
   * @param options
   */
  async initAsPrimary(options?: ClusterfyPrimaryOptions) {
    this._options = options;

    if (!cluster.isPrimary) {
      throw new Error(
        `Can't initialize clusterfy as primary. Current process is worker process.`
      );
    }
  }

  /**
   * Initializes the worker with Clusterfy and waits for metadata from primary. This method must be called on worker (see
   * example). Wait until this method returns. If you want to include graceful shutdown on process signals you need to
   * add `ClusterfySecondaryOptions.shutdown`.
   * @param ClusterfySecondaryOptions
   */
  async initAsWorker(
    options?: ClusterfyWorkerOptions
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (cluster.isPrimary) {
        reject(
          new Error(
            `Can't initialize clusterfy as worker. Current process is primary.`
          )
        );
      }

      this.initShutdownRoutine(options?.shutdown);

      process.on('exit', () => {
        this.destroy();
      });

      process.on('message', (message: ClusterfyIPCEvent) => {
        this.onMessageReceived(undefined, message);
      });

      this._currentWorker = new ClusterfyWorker(
        cluster.worker,
        ClusterfyIPCMethod.message,
        undefined,
        options
      );

      const subscr = this._events.subscribe({
        next: (event) => {
          if (
            event.type === 'result' &&
            event.data.command === 'cy_worker_set_metadata' &&
            event.data?.result?.status === 'success'
          ) {
            this._currentWorker.name = event.data?.result?.data?.name;

            this.sendMessage(
              {
                type: 'primary'
              },
              {
                type: 'ready',
                timestamp: Date.now(),
                sender: {
                  id: this._currentWorker?.worker?.id,
                  name: this._currentWorker?.name
                }
              }
            );

            this._events.next({
              type: 'ready',
              timestamp: Date.now()
            });
            this.changeCurrentWorkerStatus(ClusterfyWorkerStatus.IDLE);

            subscr.unsubscribe();
            resolve();
          }
        }
      });
      this.changeCurrentWorkerStatus(ClusterfyWorkerStatus.LOADED);
    });
  }

  /**
   * on primary
   * @param name
   * @param options
   */
  fork(
    name?: string,
    options?: ClusterfyWorkerOptions
  ): ClusterfyWorker {
    const worker = new ClusterfyWorker(cluster.fork(), ClusterfyIPCMethod.message, name, options);
    worker.worker.on('online', () => {
      this.onWorkerOnline(worker, name);
    });
    worker.worker.on('disconnect', () => {
      this.onWorkerDisconnect(worker);
    });
    worker.worker.on('error', (error: Error) => {
      this.onWorkerError(worker, error);
    });
    worker.worker.on('exit', (code: number, signal: string) => {
      this.onWorkerExit(worker, code, signal);
    });
    worker.worker.on('listening', (address: _cluster.Address) => {
      this.onWorkerListening(worker, address);
    });
    worker.worker.on('message', (message) => {
      this.onMessageReceived(worker, message);
    });
    this._workers.push(worker);

    return worker;
  }

  /**
   * on primary
   * @param worker
   * @param name
   */
  private onWorkerOnline = async (
    worker: ClusterfyWorker,
    name?: string
  ) => {
    await this.waitForStatus(worker, [ClusterfyWorkerStatus.LOADED]);
    /* TODO send meta data to worker
    Clusterfy.runIPCCommand<void>(
      this._commands.cy_worker_set_metadata.name,
      { name },
      {
        id: worker.worker.id,
        name: worker.name
      }
    );
     */

    this._events.next({
      type: 'online',
      sender: {
        id: worker.worker.id,
        name: worker.name
      },
      timestamp: Date.now()
    });
  };

  /**
   * on primary
   * @param worker
   */
  private onWorkerDisconnect = (worker: ClusterfyWorker) => {
    this._events.next({
      type: 'disconnect',
      sender: {
        id: worker.worker.id,
        name: worker.name
      },
      timestamp: Date.now()
    });
  };

  /**
   * on primary
   * @param worker
   * @param error
   */
  private onWorkerError = (worker: ClusterfyWorker, error: Error) => {
    this._events.next({
      type: 'error',
      data: error,
      sender: {
        id: worker.worker.id,
        name: worker.name
      },
      timestamp: Date.now()
    });
  };

  /**
   * on primary
   * @param worker
   * @param code
   * @param signal
   */
  private onWorkerExit = (
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
        signal
      },
      sender: {
        id: worker.worker.id,
        name: worker.name
      },
      timestamp: Date.now()
    });

    if (worker.options.revive && !signal && code > 0) {
      //revive worker
      this.fork(worker.name, worker.options);
    }
  };

  /**
   * on primary
   * @param worker
   * @param address
   */
  private onWorkerListening = (
    worker: ClusterfyWorker,
    address: _cluster.Address
  ) => {
    this._events.next({
      type: 'listening',
      data: {
        address
      },
      sender: {
        id: worker.worker.id,
        name: worker.name
      },
      timestamp: Date.now()
    });
  };

  /***
   * sends a message to primary process or a worker. If workerID is undefined the message is sent to all workers.
   * @param target
   * @param message
   * @param targetID
   * @param redirection
   */
  private sendMessage(
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
        // send from worker to primary
        if (!this.currentWorker?.worker.isDead()) {
          process.send(message, handle);
        } else {
          handle(new Error(`Worker ${this.currentWorker?.name} is dead.`));
        }
      } else {
        // send from primary to worker
        const sendMessage = (worker: _cluster.Worker) => {
          if (!worker) {
            handle(new Error(`Error: Worker not found with id ${target.id}`));
          }
          if (worker.isDead()) {
            handle(
              new Error(`Worker ${this.currentWorker?.name} is dead.`)
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


  /**
   * on primary
   * @param worker
   * @param message
   */
  private onMessageReceived = (
    worker?: ClusterfyWorker,
    message?: ClusterfyIPCEvent
  ): void => {
    if (message.type === 'command') {
      const convertedEvent = { ...message } as ClusterfyCommandRequest<any>;
      const parameters = convertedEvent.data.args;
      const commandObject = this._commands[convertedEvent.data.command];

      if (cluster.isPrimary) {
        if (!message.target?.id && message.target?.name) {
          const found = this._workers.find(
            (a) => a.name === message.target.name
          );
          convertedEvent.target = {
            id: found?.worker.id,
            name: found?.name
          };
        }
      }

      if (
        (convertedEvent.target === undefined &&
          cluster.isPrimary) || // or target is worker
        (convertedEvent.target !== undefined &&
          !cluster.isPrimary &&
          (!convertedEvent.target.id ||
            convertedEvent.target.id === cluster.worker.id) &&
          (!convertedEvent.origin?.id ||
            convertedEvent.origin?.id !== cluster.worker.id))
      ) {
        let returnDirection: 'primary' | 'worker' = 'worker';

        if (convertedEvent.target !== undefined) {
          returnDirection = 'primary';
          if (convertedEvent.target?.id) {
            // message from worker to worker => switch sender with target
            const sender = { ...convertedEvent.sender };
            convertedEvent.sender = { ...convertedEvent.target };
            convertedEvent.target = sender;
          }
        }

        this.runOnTarget(commandObject, parameters, convertedEvent)
          .then((result) => {
            const response = { ...convertedEvent };
            response.data.result = result;
            this.sendMessage(
              {
                type: returnDirection,
                ...convertedEvent.sender
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
                stack: error?.stack
              }
            };
            this.sendMessage(
              {
                type: returnDirection,
                ...convertedEvent.sender
              },
              convertedEvent
            ).catch((error) => {
              this._events.error(error);
            });
          });
      } else if (
        cluster.isPrimary &&
        convertedEvent.target?.id &&
        convertedEvent.sender?.id
      ) {
        const target = { ...convertedEvent.target };
        if (convertedEvent.target.id == convertedEvent.origin?.id) {
          convertedEvent.sender = undefined;
          convertedEvent.target = undefined;
        }
        this.sendMessage(
          {
            type: 'worker',
            ...target
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
      this._events.next({
        ...message,
        type: 'status',
        data: message?.data?.args
      });
    } else {
      this._events.next(message);
    }
  };

  private runOnTarget = async (
    commandObject: ClusterfyCommand,
    args: Record<string, any>,
    commandEvent?: ClusterfyCommandRequest<any>
  ) => {
    if (commandEvent.data?.command === 'cy_shutdown') {
      args = {
        commands: this._shutdownCommands
      };
    }

    const result = await commandObject.runOnTarget(args, commandEvent);
    this._events.next({
      timestamp: Date.now(),
      type: 'result',
      data: {
        command: commandEvent.data?.command,
        result
      }
    });
    return result;
  };

  /**
   * on primary
   * @param worker
   * @param status
   */
  waitForStatus(
    worker: ClusterfyWorker,
    status: ClusterfyWorkerStatus[]
  ) {
    return new Promise<void>((resolve, reject) => {
      if (status.includes(worker.status)) {
        resolve();
      } else {
        const subscription = this._events.subscribe({
          next: (event) => {
            if (
              event.type === 'status' &&
              event.sender.id === worker.worker.id &&
              status.includes(event.data.newStatus)
            ) {
              subscription.unsubscribe();
            }
            resolve();
          }
        });
      }
    });
  }

  override destroy = () => {
    if (cluster.isPrimary) {
      if (this._workers) {
        for (const { worker } of this._workers) {
          worker.removeAllListeners();
        }
      }

      process.removeAllListeners();
    } else {
      process.removeAllListeners();
    }
  };

  /**
   * run by worker only
   * @param signal
   */
  private initShutdownRoutine(
    shutdownOptions?: ClusterfyShutdownOptions
  ) {
    if (shutdownOptions?.gracefulOnSignals) {
      for (const signal of shutdownOptions.gracefulOnSignals) {
        process.on(signal, this.onShutdown);
      }
    }
  }

  /**
   * run by worker only
   * @param signal
   */
  private onShutdown = (signal?: NodeJS.Signals) => {
    if (this._shutdownRunning) {
      // shutdown already called, ignore this call
      return;
    }
    this._shutdownRunning = true;

    const promises = [];
    for (const shutdownCommand of this._shutdownCommands) {
      promises.push(shutdownCommand.command(signal));
    }

    Promise.all(promises).then(() => {
      process.exit(0);
    });
  };
}
