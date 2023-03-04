import * as process from 'process';
import * as _cluster from 'cluster';
import * as child from 'node:child_process';
const cluster = _cluster as unknown as _cluster.Cluster

export class ClusterfyStorage<T> {
    private _snapshot: T;
    private _workers: _cluster.Worker[] = [];

    constructor(initState: T) {
        this._snapshot = initState;
    }

    public initAsPrimary(workers: _cluster.Worker[]) {
        this._workers = workers;

        for (let i = 0; i < workers.length; i++) {
            const worker = workers[i];
            worker.on('message', (message) => {
                this.onMessageReceived(worker, message);
            });
        }
    }

    public initAsWorker() {
        process.on('message', (message: child.Serializable) => {
            this.onMessageReceived(undefined, message);
        });
    }

    public sendMessageToWorker(id: number, message: child.Serializable): Promise<void> {
        return new Promise((resolve, reject) => {
            const worker = this._workers.find(a => a.id === id);
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

    public sendMessageToPrimary(message: child.Serializable): Promise<void> {
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

    private onMessageReceived = (worker?: _cluster.Worker, message?: child.Serializable): void => {
        if (cluster.isPrimary) {
            console.log(`Primary received message from worker ${worker!.id}: ${message}`);
        } else {
            // worker
            console.log(`Worker ${process.ppid} received message from parent: ${message}`);
            console.log(message);
        }
    };

    public destroy() {
        if (cluster.isPrimary) {
            for (const worker of this._workers) {
                worker.off('message', this.onMessageReceived);
            }
        } else {
            process.off('message', this.onMessageReceived);
        }
    }
}
