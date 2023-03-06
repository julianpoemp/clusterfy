export interface ClusterfyIPCEvent {
  type: 'command' | 'online';
  data: any;
  senderID?: number;
  target?: {
    id?: number;
    name?: string;
  };
  originID?: number;
  timestamp: number;
}

export interface ClusterfyCommandRequestResult<T> extends Record<string, any> {
  status: 'success' | 'error';
  error?: {
    message?: string;
    stack?: string;
  };
  data?: T;
}

export interface ClusterfyCommandRequest<T> extends ClusterfyIPCEvent {
  type: 'command';
  data: {
    command: string;
    args: Record<string, any>;
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
