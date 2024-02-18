import { ClusterfyIPCMethod, ClusterfyWorkerOptions } from 'clusterfy';
import * as _cluster from 'cluster';
const cluster = _cluster as unknown as _cluster.Cluster;
import * as process from 'process';

export interface ClusterfyWorkerStatisticItem {
  id: number;
  name: string;
  status: ClusterfyWorkerStatus;
}

export interface ClusterfyWorkerStatistics {
  list: ClusterfyWorkerStatisticItem[];
  workersOnline: number;
}

export enum ClusterfyWorkerStatus {
  // worker is online and does nothing
  'INITIALIZING' = 'INITIALIZING',
  'LOADED' = 'LOADED',
  'IDLE' = 'IDLE',
  'PROCESSING' = 'PROCESSING',
  'STOPPING' = 'STOPPING',
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
  private _method: ClusterfyIPCMethod;

  private _options: ClusterfyWorkerOptions = {
    revive: false
  };

  public changeStatus(status: ClusterfyWorkerStatus) {
    this._status = status;
  }


  constructor(
    worker: _cluster.Worker,
    method: ClusterfyIPCMethod,
    name?: string,
    options?: ClusterfyWorkerOptions
  ) {
    console.log('worker is ' + process?.pid + ` parent ${process?.ppid}`);
    this._worker = worker;
    this._name = name;
    this._method = method;
    this._options = options ?? this._options;
  }
}
