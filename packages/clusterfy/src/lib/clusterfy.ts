import * as process from 'process';
import * as _cluster from 'cluster';
import {
    ClusterfyCommandRequest,
    ClusterfyCommandRequestResult,
    ClusterfyIPCEvent,
    ClusterfyWorkerStatistics
} from './types';
import {Subject} from 'rxjs';
import {v4 as UUIDv4} from 'UUID';

const cluster = _cluster as unknown as _cluster.Cluster

export class Clusterfy {
    static get events(): Subject<ClusterfyIPCEvent> {
        return this._events;
    }

    static get workers(): ClusterfyWorker[] {
        return this._workers;
    }

    private static _workers: ClusterfyWorker[] = [];
    private static storage: ClusterfyStorage<unknown>;
    private static _events: Subject<ClusterfyIPCEvent>;
    private static _commands: {
        name: string;
        target: 'primary' | 'worker';
        handlers: {
            runOnTarget: (args: Record<string, any>, commandEvent?: ClusterfyCommandRequest<any>) => Promise<ClusterfyCommandRequestResult<any>>;
        }
    }[] = [];

    static get currentWorker(): _cluster.Worker {
        return cluster.worker;
    }

    static init<T>(storage: ClusterfyStorage<T>) {
        Clusterfy.storage = storage;
    }

    static initDefaultCommands() {
        Clusterfy.registerIPCCommand('storage_save', 'primary', Clusterfy.handleStorageSave);
        Clusterfy.registerIPCCommand('storage_retrieve', 'primary', Clusterfy.handleStorageRetrieve);
        Clusterfy.registerIPCCommand('get_timestamp', 'worker', Clusterfy.handleGetTimestamp);
    }

    static fork(name?: string): _cluster.Worker {
        const worker = cluster.fork();
        this._workers.push(new ClusterfyWorker(worker, name));

        return worker;
    }

    static initAsPrimary() {
        if (!cluster.isPrimary) {
            throw new Error('Can\'t initialize clusterfy as primary. Current process is worker process.');
        }

        Clusterfy.initDefaultCommands();
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
            throw new Error('Can\'t initialize clusterfy as worker. Current process is primary.');
        }

        Clusterfy.initDefaultCommands();
        this._events = new Subject<ClusterfyIPCEvent>();
        process.on('message', (message: ClusterfyIPCEvent) => {
            Clusterfy.onMessageReceived(undefined, message);
        });
    }

    private static handleStorageSave = async ({
                                                  path,
                                                  value
                                              }: Record<string, any>, commandEvent?: ClusterfyCommandRequest<any>) => {
        this.storage.save(path, value);
        const result = {
            status: 'success',
            data: undefined
        } as ClusterfyCommandRequestResult<any>;

        return result;
    }

    private static handleStorageRetrieve = async ({path}: Record<string, any>, commandEvent?: ClusterfyCommandRequest<any>) => {
        if (Clusterfy.isCurrentProcessPrimary()) {
            const data = this.storage.retrieve(path);
            const result = {
                status: 'success',
                data
            } as ClusterfyCommandRequestResult<any>;

            return result;
        } else {
            throw Error(`handleStorageRetrieve must be called on primary!`);
        }
    }

    private static handleGetTimestamp = async (args: Record<string, any>, commandEvent?: ClusterfyCommandRequestResult<any>) => {
        return {
            status: 'success',
            data: 'timestamp is ' + Date.now()
        } as ClusterfyCommandRequestResult<any>
    }

    /***
     * sends a message to primary process or a worker. If workerID is undefined the message is sent to all workers.
     * @param target
     * @param message
     * @param targetID
     */
    static sendMessage(target: 'primary' | 'worker', message: ClusterfyIPCEvent, targetID?: number, redirection = false): Promise<void> {
        return new Promise((resolve, reject) => {
            const handle = (error: Error) => {
                if (error) {
                    reject(error);
                } else {
                    resolve();
                }
            };

            if (target === 'primary' || redirection) {
                process.send(message, handle);
            } else {
                // worker
                const sendMessage = (worker: _cluster.Worker) => {
                    if (worker) {
                        worker.send(message, handle);
                    } else {
                        console.log(`Error: Worker not found with id ${targetID}`);
                    }
                };

                if (targetID) {
                    const {worker} = this._workers.find(a => a.worker.id === targetID);
                    sendMessage(worker);
                } else {
                    for (const worker of this._workers) {
                        sendMessage(worker.worker);
                    }
                }
            }
        });
    }

    static onMessageReceived = (worker?: ClusterfyWorker, message?: ClusterfyIPCEvent): void => {
        const sender = this._workers.find(a => a.worker.id === message.senderID);

        if (message.type === 'command') {
            const convertedEvent = {...message} as ClusterfyCommandRequest<any>;
            const parameters = convertedEvent.data.args;
            const commandObject = this._commands.find(a => a.name === convertedEvent.data.command);

            if (!commandObject) {
                throw new Error(`Can't run command "${commandObject.name}". Not found.`);
            }

            if (commandObject.target === 'primary' && Clusterfy.isCurrentProcessPrimary() ||
                ( // or target is worker
                    commandObject.target === 'worker' && !Clusterfy.isCurrentProcessPrimary() &&
                    ((!convertedEvent.targetID || convertedEvent.targetID === Clusterfy.currentWorker.id) &&
                        (convertedEvent.originID && convertedEvent.originID !== Clusterfy.currentWorker.id))
                )
            ) {
                if (!worker?.worker) {
                    console.log(`Worker ${Clusterfy.currentWorker.id} got message from ${convertedEvent.senderID} to ${convertedEvent.targetID} of type ${convertedEvent.data?.command}`);
                } else {
                    console.log(`Primary got message from ${convertedEvent.senderID} to ${convertedEvent.targetID} of type ${convertedEvent.type} ${convertedEvent.data?.command}`);
                }

                let returnDirection: 'primary' | 'worker' = 'worker';

                if (commandObject.target === 'worker') {
                    returnDirection = 'primary';
                    if (convertedEvent.targetID) {
                        // message from worker to worker => switch sender with target
                        const senderID = convertedEvent.senderID;
                        convertedEvent.senderID = convertedEvent.targetID;
                        convertedEvent.targetID = senderID;
                    }
                }

                commandObject.handlers.runOnTarget(parameters, convertedEvent).then((result) => {
                    const response = {...convertedEvent};
                    response.data.result = result;
                    Clusterfy.sendMessage(returnDirection, response, convertedEvent.senderID);
                }).catch((error) => {
                    convertedEvent.data.result = {
                        status: 'error',
                        error: {
                            message: error?.message ?? error,
                            stack: error?.stack
                        }
                    };
                    Clusterfy.sendMessage(returnDirection, convertedEvent, convertedEvent.senderID);
                });
            } else if (Clusterfy.isCurrentProcessPrimary() && convertedEvent.targetID && convertedEvent.senderID) {
                if (!worker?.worker) {
                    console.log(`Worker ${Clusterfy.currentWorker.id} got message from ${convertedEvent.senderID} to ${convertedEvent.targetID} of type ${convertedEvent.data?.command}`);
                } else {
                    console.log(`Primary got message from ${convertedEvent.senderID} to ${convertedEvent.targetID} of type ${convertedEvent.type} ${convertedEvent.data?.command}`);
                }

                const targetID = convertedEvent.targetID;
                if (convertedEvent.targetID == convertedEvent.originID) {
                    convertedEvent.senderID = undefined;
                    convertedEvent.targetID = undefined;
                }
                Clusterfy.sendMessage('worker', convertedEvent, targetID);
            }
        }

        Clusterfy._events.next(message);
    };

    static async saveToStorage(path: string, value: any): Promise<void> {
        return this.runIPCCommand<void>('storage_save', {path, value});
    }

    private static waitForCommandResultEvent<T>(command: string, uuid?: string) {
        return new Promise<T>((resolve, reject) => {
            const subscription = this._events.subscribe({
                next: (event: ClusterfyCommandRequest<any>) => {
                    if (event.data.command === command && event.data.uuid && uuid === event.data.uuid) {
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

    static retrieveFromStorage<T>(path: string): Promise<T> {
        return this.runIPCCommand<T>('storage_retrieve', {path});
    }

    static getStatistics(): ClusterfyWorkerStatistics {
        if (!cluster.isPrimary) {
            throw new Error('Can\'t read statistics. Current process is worker process.');
        }
        const result: ClusterfyWorkerStatistics = {
            list: []
        };

        for (const worker of this._workers) {
            result.list.push({
                id: worker.worker.id,
                name: worker.name,
                status: worker.status
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

            for (const {id, name, status} of statistics.list) {
                console.log(`|\t${id}\t|\t${name}\t|\t${status}\t|\t${JSON.stringify(this.storage)}\t`)
            }

            console.log(`---------------------------------------------------------`);
        }
    }

    static registerIPCCommand<R>(command: string, target: 'primary' | 'worker',
                                 runOnTarget: (args: Record<string, any>) => Promise<ClusterfyCommandRequestResult<R>>) {
        Clusterfy._commands.push({
            target,
            name: command,
            handlers: {
                runOnTarget
            }
        });
    }

    static async runIPCCommand<T>(command: string, args: Record<string, any>, targetID?: number): Promise<T> {
        const commandObject = this._commands.find(a => a.name === command);

        if (!commandObject) {
            throw new Error(`Can't run command "${command}". Not found.`);
        }

        if (commandObject.target === 'primary' && Clusterfy.isCurrentProcessPrimary() ||
            (commandObject.target === 'worker' && !Clusterfy.isCurrentProcessPrimary() && (!targetID || targetID === Clusterfy.currentWorker.id))) {
            const result = await commandObject.handlers.runOnTarget(args);
            return result.data;
        } else {
            const uuid = UUIDv4();
            this.sendMessage(commandObject.target, {
                type: 'command',
                data: {
                    command,
                    args,
                    uuid,
                },
                senderID: cluster.worker?.id,
                targetID,
                originID: Clusterfy.currentWorker?.id,
                timestamp: Date.now()
            } as ClusterfyCommandRequest<any>, targetID, (commandObject.target === 'worker' && !Clusterfy.isCurrentProcessPrimary()));
            return Clusterfy.waitForCommandResultEvent(command, uuid);
        }
    }

    static destroy() {
        if (cluster.isPrimary) {
            for (const {worker} of this._workers) {
                worker.off('message', Clusterfy.onMessageReceived);
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
            throw new Error('Can\'t read path. Path must not be empty or undefined');
        }
        const splitted = path.split('.').filter(a => a !== '' && a !== undefined);
        if (splitted.length === 0) {
            throw new Error(`Can't save value to ClusterfyStorage. Missing points in string.`);
        }

        return splitted;
    }

    private saveValueToObject(object: any, value: any, remaining: string[], processed: string[] = []) {
        if (remaining.length === 0) {
            return object;
        }

        const attr = remaining[0];
        processed.push(attr);
        if (Object.keys(object).includes(attr) || remaining.length === 1) {
            if (remaining.length > 1) {
                object[attr] = this.saveValueToObject(object[attr], value, remaining.slice(1), processed);
            } else {
                object[attr] = value;
            }
        } else {
            throw new Error(`Can't save value to ClusterfyStorage. Key '${processed.join('.')}' does not exist.`)
        }

        return object;
    }

    private readValueFromObject(object: any, remaining: string[], processed: string[] = []) {
        if (remaining.length === 0) {
            return object;
        }

        const attr = remaining[0];
        processed.push(attr);
        if (Object.keys(object).includes(attr) || remaining.length === 1) {
            if (remaining.length > 1) {
                return this.readValueFromObject(object[attr], remaining.slice(1), processed);
            } else {
                return object[attr];
            }
        } else {
            throw new Error(`Can't save value to ClusterfyStorage. Key '${processed.join('.')}' does not exist.`)
        }

        return object;
    }
}

export class ClusterfyWorker {
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
