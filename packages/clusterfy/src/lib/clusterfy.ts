import * as process from 'process';
import * as _cluster from 'cluster';
import * as child from 'node:child_process';
import {ClusterfyWorkerStatistics} from './types';

const cluster = _cluster as unknown as _cluster.Cluster

export class Clusterfy {
    private static _workers: ClusterfyWorker[] = [];
    private static storage: ClusterfyStorage<unknown>;

    static init<T>(storage: ClusterfyStorage<T>) {
        Clusterfy.storage = storage;
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

        process.on('message', (message: child.Serializable) => {
            Clusterfy.onMessageReceived(undefined, message);
        });
    }

    static sendMessageToWorker(id: number, message: child.Serializable): Promise<void> {
        return new Promise((resolve, reject) => {
            const {worker} = this._workers.find(a => a.worker.id === id);
            if (worker) {
                worker.send(message, (error: Error) => {
                    if (error) {
                        reject(error);
                    } else {
                        resolve();
                    }
                });
            } else {
                console.log(`Error: Worker not found with id ${id}`);
            }
        });
    }

    static sendMessageToPrimary(message: child.Serializable): Promise<void> {
        return new Promise((resolve, reject) => {
            process.send(message, (error: Error) => {
                if (error) {
                    reject(error);
                } else {
                    resolve();
                }
            });
        });
    }

    static onMessageReceived = (worker?: ClusterfyWorker, message?: child.Serializable): void => {
        if (cluster.isPrimary) {
            console.log(`Primary received message from worker ${worker!.worker.id} (${worker!.name}): ${message}`);
        } else {
            // worker
            console.log(`Worker ${process.ppid} received message from parent: ${message}`);
            console.log(message);
        }
    };

    static saveToStorage(path: string, value: any): Promise<void> {
        if (this.isCurrentProcessPrimary()) {
            return new Promise<void>((resolve, reject) => {
                try {
                    this.storage.save(path, value);
                    resolve();
                } catch (e) {
                    reject(e);
                }
            });
        } else {
            // TODO implement
            // 1. send request to primary
            // 2. wait for result
            // 3. return promise
        }

        console.log(JSON.stringify(this.storage));
    }

    static retrieveFromStorage(path: string) {
        if (this.isCurrentProcessPrimary()) {
            const result = this.storage.retrieve(path);
            console.log(JSON.stringify(result));
        } else {
            // TODO send request to primary
        }
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
        const statistics = Clusterfy.getStatistics();
        console.log('____________________Clusterfy Statistics_________________');
        console.log('|\tid\t|\tname\t\t|\tstatus\t|');
        console.log(`---------------------------------------------------------`);

        for (const {id, name, status} of statistics.list) {
            console.log(`|\t${id}\t|\t${name}\t|\t${status}\t|`)
        }

        console.log(`---------------------------------------------------------`);
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

    retrieve(path: string): any {
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
    private _status = 'running';
    private _name: string;

    constructor(worker: _cluster.Worker, name?: string) {
        this._worker = worker;
        this._name = name;
    }
}
