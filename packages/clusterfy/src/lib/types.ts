import * as cluster from 'cluster';

export interface ClusterfyIPCEvent {
    type: string;
    data: unknown;
    sender: cluster.Worker;
    timestamp: number;
}

export interface ClusterfyCommandRequest extends ClusterfyIPCEvent {
    type: 'command';
    data: {
        command: string;
        uuid: string;
        result?: unknown;
    };
    sender: cluster.Worker;
}

export interface ClusterfyWorkerStatisticItem {
    id: number;
    name: string;
    status: string;
}

export interface ClusterfyWorkerStatistics {
    list: ClusterfyWorkerStatisticItem[];
}
