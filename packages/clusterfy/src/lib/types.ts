export interface ClusterfyIPCEvent {
    type: string;
    data: any;
    senderID?: number;
    targetID?: number;
    originID?: number;
    timestamp: number;
}

export interface ClusterfyCommandRequestResult<T> extends Record<string, any> {
    status: 'success' | 'error';
    error?: {
        message?: string;
        stack?: string;
    }
    data?: T;
}

export interface ClusterfyCommandRequest<T> extends ClusterfyIPCEvent {
    type: 'command';
    data: {
        command: string;
        args: any[];
        uuid: string;
        result?: ClusterfyCommandRequestResult<T>;
    };
}

export interface ClusterfyWorkerStatisticItem {
    id: number;
    name: string;
    status: string;
}

export interface ClusterfyWorkerStatistics {
    list: ClusterfyWorkerStatisticItem[];
}
