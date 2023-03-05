export interface ClusterfyIPCEvent {
    type: string;
    data: any;
    senderID?: number;
    timestamp: number;
}

export interface ClusterfyCommandRequestResult extends Record<string, any> {
    status: 'success' | 'error';
    message?: string;
    data?: any;
}

export interface ClusterfyCommandRequest extends ClusterfyIPCEvent {
    type: 'command';
    data: {
        command: string;
        args: any[];
        uuid: string;
        result?: ClusterfyCommandRequestResult;
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
