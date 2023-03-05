export interface ClusterfyIPCEvent {
    type: string;
    data: any;
    senderID?: number;
    targetID?: number;
    timestamp: number;
}

export interface ClusterfyCommandRequestResult<T> extends Record<string, any> {
    status: 'success' | 'error';
    message?: string;
    stack?: string;
    data?: T;
}

export interface ClusterfyCommandRequest<T> extends ClusterfyIPCEvent {
    type: 'command';
    data: {
        command: string;
        args: any[];
        uuid: string;
        result?: ClusterfyCommandRequestResult<T>;
        duration?: number;
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
